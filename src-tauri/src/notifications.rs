use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

use crate::{
    attention::{AttentionReason, AttentionTransition},
    database::{Database, DatabaseError},
    settings::NotificationSettings,
};

pub const OPEN_PULL_REQUEST_EVENT: &str = "mission-control://open-pull-request";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationDeliveryPlan {
    pub attention_item_id: String,
    pub transition_key: String,
    pub pull_request_id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPullRequestEvent {
    pull_request_id: String,
}

#[derive(Debug, Error)]
pub enum NotificationDeliveryError {
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error("could not deliver notification: {0}")]
    Transport(String),
}

pub trait NotificationTransport {
    fn send(&self, plan: &NotificationDeliveryPlan) -> Result<(), String>;
}

pub struct NativeNotificationTransport {
    app: AppHandle,
}

impl NativeNotificationTransport {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl NotificationTransport for NativeNotificationTransport {
    fn send(&self, plan: &NotificationDeliveryPlan) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            "com.leoengithub.mission-control-desktop"
        });

        let mut notification = notify_rust::Notification::new();
        notification
            .appname("Mission Control")
            .summary(&plan.title)
            .body(&plan.body)
            .action("open", "Open pull request");
        let handle = notification.show().map_err(|error| error.to_string())?;
        let app = self.app.clone();
        let pull_request_id = plan.pull_request_id.clone();
        std::thread::spawn(move || {
            handle.wait_for_action(move |action| {
                if action == "__closed" {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit(
                    OPEN_PULL_REQUEST_EVENT,
                    OpenPullRequestEvent { pull_request_id },
                );
            });
        });
        Ok(())
    }
}

pub fn should_notify(settings: &NotificationSettings, transition: &AttentionTransition) -> bool {
    if !settings.enabled {
        return false;
    }

    let AttentionTransition::Activated(item) = transition else {
        return false;
    };

    match item.reason {
        AttentionReason::ReviewRequested => settings.review_requested,
        AttentionReason::UnresolvedThread => settings.unresolved_thread,
        AttentionReason::RequiredChecksFailing => settings.required_checks_failing,
        AttentionReason::AgentWaitingForUser => settings.agent_waiting_for_user,
        AttentionReason::AgentFailed => settings.agent_failed,
        AttentionReason::AgentStalled => settings.agent_stalled,
        AttentionReason::AgentInterrupted => settings.agent_interrupted,
    }
}

pub fn deliver_transitions<T: NotificationTransport>(
    database: &Database,
    settings: &NotificationSettings,
    transitions: &[AttentionTransition],
    transport: &T,
) -> Result<usize, NotificationDeliveryError> {
    let mut delivered = 0;
    for transition in transitions {
        if !should_notify(settings, transition) {
            continue;
        }
        let Some(plan) = delivery_plan(database, transition)? else {
            continue;
        };
        if !claim_delivery(database, &plan)? {
            continue;
        }
        if let Err(error) = transport.send(&plan) {
            release_delivery(database, &plan)?;
            return Err(NotificationDeliveryError::Transport(error));
        }
        delivered += 1;
    }
    Ok(delivered)
}

fn delivery_plan(
    database: &Database,
    transition: &AttentionTransition,
) -> Result<Option<NotificationDeliveryPlan>, DatabaseError> {
    let AttentionTransition::Activated(item) = transition else {
        return Ok(None);
    };
    database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT r.full_name, p.number, p.title FROM pull_requests p \
                 JOIN repositories r ON r.id = p.repository_id WHERE p.id = ?1",
                [&item.pull_request_id],
                |row| {
                    let repository: String = row.get(0)?;
                    let number: i64 = row.get(1)?;
                    let pull_request_title: String = row.get(2)?;
                    Ok(NotificationDeliveryPlan {
                        attention_item_id: item.id.clone(),
                        transition_key: format!(
                            "activated:{}",
                            item.first_detected_at.to_rfc3339()
                        ),
                        pull_request_id: item.pull_request_id.clone(),
                        title: notification_title(item.reason, &repository, number),
                        body: if item.summary.is_empty() {
                            pull_request_title
                        } else {
                            item.summary.clone()
                        },
                    })
                },
            )
            .map(Some)
    })
}

fn claim_delivery(
    database: &Database,
    plan: &NotificationDeliveryPlan,
) -> Result<bool, DatabaseError> {
    database.with_connection(|connection| {
        connection
            .execute(
                "INSERT OR IGNORE INTO notification_deliveries \
                 (attention_item_id, transition_key, delivered_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    plan.attention_item_id,
                    plan.transition_key,
                    Utc::now().to_rfc3339(),
                ],
            )
            .map(|changed| changed == 1)
    })
}

fn release_delivery(
    database: &Database,
    plan: &NotificationDeliveryPlan,
) -> Result<(), DatabaseError> {
    database.with_connection(|connection| {
        connection.execute(
            "DELETE FROM notification_deliveries WHERE attention_item_id = ?1 AND transition_key = ?2",
            rusqlite::params![plan.attention_item_id, plan.transition_key],
        )?;
        Ok(())
    })
}

fn notification_title(reason: AttentionReason, repository: &str, number: i64) -> String {
    let reason = match reason {
        AttentionReason::ReviewRequested => "Review requested",
        AttentionReason::UnresolvedThread => "Review thread unresolved",
        AttentionReason::RequiredChecksFailing => "Required checks failing",
        AttentionReason::AgentWaitingForUser => "Agent needs your input",
        AttentionReason::AgentFailed => "Agent run failed",
        AttentionReason::AgentStalled => "Agent run stalled",
        AttentionReason::AgentInterrupted => "Agent run interrupted",
    };
    format!("{reason} · {repository} #{number}")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::{TimeZone, Utc};
    use tempfile::tempdir;

    use super::*;
    use crate::attention::{AttentionCandidate, AttentionItem, AttentionRepository};

    struct RecordingTransport {
        attempts: Mutex<usize>,
        should_fail: bool,
    }

    impl RecordingTransport {
        fn successful() -> Self {
            Self {
                attempts: Mutex::new(0),
                should_fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                attempts: Mutex::new(0),
                should_fail: true,
            }
        }
    }

    impl NotificationTransport for RecordingTransport {
        fn send(&self, _plan: &NotificationDeliveryPlan) -> Result<(), String> {
            *self.attempts.lock().unwrap() += 1;
            if self.should_fail {
                Err("transport unavailable".into())
            } else {
                Ok(())
            }
        }
    }

    fn database_with_activation() -> (Database, AttentionTransition) {
        let directory = tempdir().unwrap().keep();
        let database = Database::open(directory.join("notifications.sqlite3")).unwrap();
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO repositories (
                        id, owner, name, full_name, default_branch, private
                     ) VALUES ('repo-1', 'owner', 'repo', 'owner/repo', 'main', 1)",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO pull_requests (
                        id, repository_id, number, title, url, author_login, head_ref,
                        head_sha, base_ref, draft, state, updated_at, last_synced_at
                     ) VALUES (
                        'pr-1', 'repo-1', 7, 'Test PR', 'https://example.test/pr/7', 'owner',
                        'feature', 'abc123', 'main', 0, 'open', '2026-08-03T12:00:00Z',
                        '2026-08-03T12:00:00Z'
                     )",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        let transition = AttentionRepository::new(&database)
            .reconcile_for_pull_request(
                "pr-1",
                vec![AttentionCandidate {
                    reason: AttentionReason::ReviewRequested,
                    source_id: None,
                    summary: "Your review is requested".into(),
                }],
                now,
            )
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        (database, transition)
    }

    fn activation(reason: AttentionReason) -> AttentionTransition {
        AttentionTransition::Activated(AttentionItem {
            id: "attention-1".into(),
            pull_request_id: "pr-1".into(),
            reason,
            source_id: None,
            summary: "Needs attention".into(),
            first_detected_at: Utc::now(),
            last_changed_at: Utc::now(),
            snoozed_until: None,
        })
    }

    #[test]
    fn notifications_are_opt_in() {
        assert!(!should_notify(
            &NotificationSettings::default(),
            &activation(AttentionReason::ReviewRequested)
        ));
    }

    #[test]
    fn only_new_actionable_transitions_notify() {
        let settings = NotificationSettings {
            enabled: true,
            ..NotificationSettings::default()
        };
        assert!(should_notify(
            &settings,
            &activation(AttentionReason::ReviewRequested)
        ));
        assert!(!should_notify(
            &settings,
            &AttentionTransition::Cleared {
                id: "attention-1".into()
            }
        ));
    }

    #[test]
    fn individual_reason_toggles_are_honored() {
        let settings = NotificationSettings {
            enabled: true,
            unresolved_thread: false,
            ..NotificationSettings::default()
        };
        assert!(!should_notify(
            &settings,
            &activation(AttentionReason::UnresolvedThread)
        ));
    }

    #[test]
    fn the_same_activation_is_delivered_only_once_across_restarts() {
        let (database, transition) = database_with_activation();
        let settings = NotificationSettings {
            enabled: true,
            ..NotificationSettings::default()
        };
        let first_transport = RecordingTransport::successful();
        assert_eq!(
            deliver_transitions(
                &database,
                &settings,
                std::slice::from_ref(&transition),
                &first_transport,
            )
            .unwrap(),
            1
        );
        let restarted_transport = RecordingTransport::successful();
        assert_eq!(
            deliver_transitions(
                &database,
                &settings,
                std::slice::from_ref(&transition),
                &restarted_transport,
            )
            .unwrap(),
            0
        );
        assert_eq!(*restarted_transport.attempts.lock().unwrap(), 0);
    }

    #[test]
    fn a_failed_delivery_releases_its_claim_for_retry() {
        let (database, transition) = database_with_activation();
        let settings = NotificationSettings {
            enabled: true,
            ..NotificationSettings::default()
        };
        assert!(
            deliver_transitions(
                &database,
                &settings,
                std::slice::from_ref(&transition),
                &RecordingTransport::failing(),
            )
            .is_err()
        );
        let retry = RecordingTransport::successful();
        assert_eq!(
            deliver_transitions(&database, &settings, &[transition], &retry).unwrap(),
            1
        );
    }
}
