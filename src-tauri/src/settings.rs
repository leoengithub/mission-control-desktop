use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;
const DEFAULT_DIFF_CACHE_MAX_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("could not read settings: {0}")]
    Read(#[source] std::io::Error),
    #[error("settings are not valid JSON: {0}")]
    Parse(#[source] serde_json::Error),
    #[error("could not serialize settings: {0}")]
    Serialize(#[source] serde_json::Error),
    #[error("could not persist settings: {0}")]
    Write(#[source] std::io::Error),
    #[error("unsupported settings schema version {0}")]
    UnsupportedVersion(u32),
    #[error("invalid settings: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    #[default]
    MenuBar,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SyncPreset {
    Faster,
    #[default]
    Balanced,
    BatterySaver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Codex,
    ClaudeCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeCleanupPolicy {
    #[default]
    SafeOnly,
    AlwaysPreserve,
    AlwaysAsk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub close_behavior: CloseBehavior,
    pub theme: Theme,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            close_behavior: CloseBehavior::MenuBar,
            theme: Theme::System,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub preset: SyncPreset,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            preset: SyncPreset::Balanced,
        }
    }
}

impl SyncPreset {
    pub fn intervals_seconds(self) -> (u32, u32) {
        match self {
            Self::Faster => (30, 120),
            Self::Balanced => (60, 300),
            Self::BatterySaver => (300, 900),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub enabled: bool,
    pub review_requested: bool,
    pub unresolved_thread: bool,
    pub required_checks_failing: bool,
    pub agent_waiting_for_user: bool,
    pub agent_failed: bool,
    pub agent_stalled: bool,
    pub agent_interrupted: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            review_requested: true,
            unresolved_thread: true,
            required_checks_failing: true,
            agent_waiting_for_user: true,
            agent_failed: true,
            agent_stalled: true,
            agent_interrupted: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    pub default_agent: Option<AgentKind>,
    pub codex_permission_bypass: bool,
    pub claude_permission_bypass: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSettings {
    pub base_directory: Option<PathBuf>,
    pub cleanup_policy: WorktreeCleanupPolicy,
}

impl Default for WorktreeSettings {
    fn default() -> Self {
        Self {
            base_directory: None,
            cleanup_policy: WorktreeCleanupPolicy::SafeOnly,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSettings {
    pub diff_cache_max_bytes: u64,
    pub diff_cache_retention_days: u16,
    pub completed_run_log_retention_days: u16,
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            diff_cache_max_bytes: DEFAULT_DIFF_CACHE_MAX_BYTES,
            diff_cache_retention_days: 7,
            completed_run_log_retention_days: 30,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    pub automatic_checks: bool,
    pub channel: UpdateChannel,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            automatic_checks: true,
            channel: UpdateChannel::Stable,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub general: GeneralSettings,
    pub sync: SyncSettings,
    pub notifications: NotificationSettings,
    pub agents: AgentSettings,
    pub worktrees: WorktreeSettings,
    pub storage: StorageSettings,
    pub updates: UpdateSettings,
    pub dismissed_contextual_prompts: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            general: GeneralSettings::default(),
            sync: SyncSettings::default(),
            notifications: NotificationSettings::default(),
            agents: AgentSettings::default(),
            worktrees: WorktreeSettings::default(),
            storage: StorageSettings::default(),
            updates: UpdateSettings::default(),
            dismissed_contextual_prompts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub general: Option<GeneralSettings>,
    pub sync: Option<SyncSettings>,
    pub notifications: Option<NotificationSettings>,
    pub agents: Option<AgentSettings>,
    pub worktrees: Option<WorktreeSettings>,
    pub storage: Option<StorageSettings>,
    pub updates: Option<UpdateSettings>,
    pub dismissed_contextual_prompts: Option<Vec<String>>,
}

pub struct SettingsStore {
    path: PathBuf,
    current: AppSettings,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Result<Self, SettingsError> {
        let current = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(SettingsError::Read)?;
            let parsed: AppSettings = serde_json::from_str(&raw).map_err(SettingsError::Parse)?;
            if parsed.schema_version > SETTINGS_SCHEMA_VERSION {
                return Err(SettingsError::UnsupportedVersion(parsed.schema_version));
            }
            parsed
        } else {
            AppSettings::default()
        };
        Ok(Self { path, current })
    }

    pub fn current(&self) -> &AppSettings {
        &self.current
    }

    pub fn update(&mut self, patch: SettingsPatch) -> Result<AppSettings, SettingsError> {
        let previous = self.current.clone();
        if let Some(value) = patch.general {
            self.current.general = value;
        }
        if let Some(value) = patch.sync {
            self.current.sync = value;
        }
        if let Some(value) = patch.notifications {
            self.current.notifications = value;
        }
        if let Some(value) = patch.agents {
            self.current.agents = value;
        }
        if let Some(value) = patch.worktrees {
            self.current.worktrees = value;
        }
        if let Some(value) = patch.storage {
            self.current.storage = value;
        }
        if let Some(value) = patch.updates {
            self.current.updates = value;
        }
        if let Some(value) = patch.dismissed_contextual_prompts {
            self.current.dismissed_contextual_prompts = value;
        }
        self.current.schema_version = SETTINGS_SCHEMA_VERSION;
        if let Err(error) = normalize_and_validate(&mut self.current) {
            self.current = previous;
            return Err(error);
        }
        if let Err(error) = persist_atomically(&self.path, &self.current) {
            self.current = previous;
            return Err(error);
        }
        Ok(self.current.clone())
    }
}

fn normalize_and_validate(settings: &mut AppSettings) -> Result<(), SettingsError> {
    const MIN_DIFF_CACHE_BYTES: u64 = 32 * 1024 * 1024;
    const MAX_DIFF_CACHE_BYTES: u64 = 10 * 1024 * 1024 * 1024;

    if !(MIN_DIFF_CACHE_BYTES..=MAX_DIFF_CACHE_BYTES)
        .contains(&settings.storage.diff_cache_max_bytes)
    {
        return Err(SettingsError::Invalid(
            "diff cache must be between 32 MiB and 10 GiB".into(),
        ));
    }
    if !(1..=365).contains(&settings.storage.diff_cache_retention_days) {
        return Err(SettingsError::Invalid(
            "diff cache retention must be between 1 and 365 days".into(),
        ));
    }
    if !(1..=365).contains(&settings.storage.completed_run_log_retention_days) {
        return Err(SettingsError::Invalid(
            "completed run log retention must be between 1 and 365 days".into(),
        ));
    }
    if let Some(path) = &settings.worktrees.base_directory
        && !path.is_absolute()
    {
        return Err(SettingsError::Invalid(
            "custom worktree directory must be absolute".into(),
        ));
    }

    settings
        .dismissed_contextual_prompts
        .retain(|prompt| !prompt.is_empty() && prompt.len() <= 100);
    settings.dismissed_contextual_prompts.sort();
    settings.dismissed_contextual_prompts.dedup();
    settings.dismissed_contextual_prompts.truncate(64);
    Ok(())
}

fn persist_atomically(path: &Path, value: &AppSettings) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(SettingsError::Write)?;
    }
    let raw = serde_json::to_vec_pretty(value).map_err(SettingsError::Serialize)?;
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary).map_err(SettingsError::Write)?;
    file.write_all(&raw).map_err(SettingsError::Write)?;
    file.sync_all().map_err(SettingsError::Write)?;
    fs::rename(temporary, path).map_err(SettingsError::Write)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn defaults_are_safe_and_match_product_decisions() {
        let settings = AppSettings::default();
        assert!(!settings.general.launch_at_login);
        assert_eq!(settings.general.close_behavior, CloseBehavior::MenuBar);
        assert_eq!(settings.sync.preset, SyncPreset::Balanced);
        assert!(!settings.notifications.enabled);
        assert_eq!(settings.agents.default_agent, None);
        assert!(!settings.agents.codex_permission_bypass);
        assert!(!settings.agents.claude_permission_bypass);
        assert_eq!(
            settings.worktrees.cleanup_policy,
            WorktreeCleanupPolicy::SafeOnly
        );
        assert_eq!(settings.storage.diff_cache_max_bytes, 250 * 1024 * 1024);
        assert_eq!(settings.storage.diff_cache_retention_days, 7);
        assert!(settings.updates.automatic_checks);
    }

    #[test]
    fn updates_are_atomic_and_survive_reload() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let mut store = SettingsStore::load(path.clone()).unwrap();
        store
            .update(SettingsPatch {
                general: Some(GeneralSettings {
                    launch_at_login: true,
                    ..GeneralSettings::default()
                }),
                ..SettingsPatch::default()
            })
            .unwrap();
        let reloaded = SettingsStore::load(path).unwrap();
        assert!(reloaded.current().general.launch_at_login);
    }

    #[test]
    fn rejects_relative_custom_worktree_directory_without_persisting_patch() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let mut store = SettingsStore::load(path).unwrap();
        let result = store.update(SettingsPatch {
            worktrees: Some(WorktreeSettings {
                base_directory: Some(PathBuf::from("relative/worktrees")),
                cleanup_policy: WorktreeCleanupPolicy::SafeOnly,
            }),
            ..SettingsPatch::default()
        });
        assert!(matches!(result, Err(SettingsError::Invalid(_))));
        assert_eq!(store.current().worktrees, WorktreeSettings::default());
    }
}
