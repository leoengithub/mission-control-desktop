#![allow(
    dead_code,
    reason = "renderer integration follows product design approval"
)]

use serde::Serialize;

use crate::settings::AppSettings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextualPrompt {
    EnableNotifications,
    EnableLaunchAtLogin,
    AttachLocalRepository,
    ConfigureAgent,
}

impl ContextualPrompt {
    pub fn key(self) -> &'static str {
        match self {
            Self::EnableNotifications => "enable_notifications",
            Self::EnableLaunchAtLogin => "enable_launch_at_login",
            Self::AttachLocalRepository => "attach_local_repository",
            Self::ConfigureAgent => "configure_agent",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextualSetupContext {
    pub activation_ready: bool,
    pub unsnoozed_attention_count: usize,
    pub local_action_attempted: bool,
    pub attached_local_repository_count: usize,
    pub detected_agent_count: usize,
}

pub fn recommended_prompts(
    settings: &AppSettings,
    context: ContextualSetupContext,
) -> Vec<ContextualPrompt> {
    if !context.activation_ready {
        return Vec::new();
    }

    let mut prompts = Vec::new();
    if context.unsnoozed_attention_count > 0 && !settings.notifications.enabled {
        prompts.push(ContextualPrompt::EnableNotifications);
    }
    if settings.notifications.enabled && !settings.general.launch_at_login {
        prompts.push(ContextualPrompt::EnableLaunchAtLogin);
    }
    if context.local_action_attempted && context.attached_local_repository_count == 0 {
        prompts.push(ContextualPrompt::AttachLocalRepository);
    }
    if context.attached_local_repository_count > 0 && context.detected_agent_count == 0 {
        prompts.push(ContextualPrompt::ConfigureAgent);
    }

    prompts.retain(|prompt| {
        !settings
            .dismissed_contextual_prompts
            .iter()
            .any(|dismissed| dismissed == prompt.key())
    });
    prompts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_context() -> ContextualSetupContext {
        ContextualSetupContext {
            activation_ready: true,
            unsnoozed_attention_count: 1,
            local_action_attempted: false,
            attached_local_repository_count: 0,
            detected_agent_count: 0,
        }
    }

    #[test]
    fn optional_features_never_block_activation() {
        let prompts = recommended_prompts(
            &AppSettings::default(),
            ContextualSetupContext {
                activation_ready: false,
                ..active_context()
            },
        );
        assert!(prompts.is_empty());
    }

    #[test]
    fn notifications_are_suggested_only_after_attention_exists() {
        let settings = AppSettings::default();
        assert_eq!(
            recommended_prompts(&settings, active_context()),
            [ContextualPrompt::EnableNotifications]
        );

        let prompts = recommended_prompts(
            &settings,
            ContextualSetupContext {
                unsnoozed_attention_count: 0,
                ..active_context()
            },
        );
        assert!(prompts.is_empty());
    }

    #[test]
    fn local_setup_is_suggested_at_the_point_of_use() {
        let prompts = recommended_prompts(
            &AppSettings::default(),
            ContextualSetupContext {
                local_action_attempted: true,
                ..active_context()
            },
        );
        assert!(prompts.contains(&ContextualPrompt::AttachLocalRepository));
    }

    #[test]
    fn dismissed_prompts_stay_dismissed() {
        let mut settings = AppSettings::default();
        settings
            .dismissed_contextual_prompts
            .push(ContextualPrompt::EnableNotifications.key().into());

        assert!(recommended_prompts(&settings, active_context()).is_empty());
    }
}
