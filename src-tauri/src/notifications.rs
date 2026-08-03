#![allow(
    dead_code,
    reason = "delivery is wired with the background sync worker"
)]

use crate::{
    attention::{AttentionReason, AttentionTransition},
    settings::NotificationSettings,
};

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

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::attention::AttentionItem;

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
}
