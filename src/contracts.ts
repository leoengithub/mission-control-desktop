export const SETTINGS_SCHEMA_VERSION = 1 as const;

export type Theme = 'system' | 'light' | 'dark';
export type CloseBehavior = 'menu_bar' | 'quit';
export type SyncPreset = 'faster' | 'balanced' | 'battery_saver';
export type AgentKind = 'codex' | 'claude_code';
export type WorktreeCleanupPolicy = 'safe_only' | 'always_preserve' | 'always_ask';
export type UpdateChannel = 'stable' | 'beta';

export interface AppSettings {
  schemaVersion: number;
  general: {
    launchAtLogin: boolean;
    closeBehavior: CloseBehavior;
    theme: Theme;
  };
  sync: {
    preset: SyncPreset;
  };
  notifications: {
    enabled: boolean;
    reviewRequested: boolean;
    unresolvedThread: boolean;
    requiredChecksFailing: boolean;
    agentWaitingForUser: boolean;
    agentFailed: boolean;
    agentStalled: boolean;
    agentInterrupted: boolean;
  };
  agents: {
    defaultAgent: AgentKind | null;
    codexPermissionBypass: boolean;
    claudePermissionBypass: boolean;
  };
  worktrees: {
    baseDirectory: string | null;
    cleanupPolicy: WorktreeCleanupPolicy;
  };
  storage: {
    diffCacheMaxBytes: number;
    diffCacheRetentionDays: number;
    completedRunLogRetentionDays: number;
  };
  updates: {
    automaticChecks: boolean;
    channel: UpdateChannel;
  };
  dismissedContextualPrompts: string[];
}

export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | 'general'
    | 'sync'
    | 'notifications'
    | 'agents'
    | 'worktrees'
    | 'storage'
    | 'updates'
    | 'dismissedContextualPrompts'
  >
>;

export interface FoundationStatus {
  settingsSchemaVersion: number;
  databaseSchemaVersion: number;
  githubAppConfigured: boolean;
  actionablePollSeconds: number;
  discoveryPollSeconds: number;
}

export type ActivationStep =
  | 'github_app_configuration_required'
  | 'github_authorization_required'
  | 'repository_access_required'
  | 'initial_sync_required'
  | 'ready';

export interface ActivationState {
  step: ActivationStep;
  githubLogin: string | null;
  accessibleRepositoryCount: number;
  initialSyncCompleted: boolean;
}

export interface DeviceAuthorization {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  pollIntervalSeconds: number;
}

export type DeviceAuthorizationPoll =
  | { state: 'pending'; retryAfterSeconds: number }
  | { state: 'authorized'; login: string; avatarUrl: string };

export type AttentionReason =
  | 'review_requested'
  | 'unresolved_thread'
  | 'required_checks_failing'
  | 'agent_waiting_for_user'
  | 'agent_failed'
  | 'agent_stalled'
  | 'agent_interrupted';

export interface AttentionItem {
  id: string;
  pullRequestId: string;
  reason: AttentionReason;
  sourceId: string | null;
  summary: string;
  firstDetectedAt: string;
  lastChangedAt: string;
  snoozedUntil: string | null;
}

export interface CachedPullRequest {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  headSha: string;
  draft: boolean;
  reviewRequested: boolean;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface GithubSyncResult {
  pullRequestCount: number;
  attentionTransitionCount: number;
  completedAt: string;
}
