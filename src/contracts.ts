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
  headRef: string;
  headSha: string;
  baseRef: string;
  draft: boolean;
  reviewRequested: boolean;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface ReviewComment {
  id: string;
  authorLogin: string;
  body: string;
  isBot: boolean;
  diffHunk: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewThread {
  id: string;
  path: string | null;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  side: string | null;
  resolved: boolean;
  outdated: boolean;
  isBot: boolean;
  hasNewActivity: boolean;
  updatedAt: string;
  comments: ReviewComment[];
}

export interface CheckRun {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  required: boolean;
  detailsUrl: string | null;
  updatedAt: string;
}

export interface PullRequestReviewDetail {
  pullRequestId: string;
  threads: ReviewThread[];
  checks: CheckRun[];
}

export interface LocalRepositoryAttachment {
  repositoryId: string;
  repository: string;
  localPath: string | null;
  defaultBranch: string;
  validationState: string;
  lastValidatedAt: string | null;
}

export type AgentAction = 'reply_resolve' | 'fix_reply_resolve' | 'open_terminal';
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'stalled';

export interface AgentRun {
  id: string;
  pullRequestId: string;
  threadId: string | null;
  action: AgentAction;
  agent: AgentKind | 'shell';
  status: AgentRunStatus;
  worktreePath: string | null;
  baseHeadSha: string | null;
  logPath: string | null;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  exitCode: number | null;
  replyPostedAt: string | null;
  resolvedAt: string | null;
}

export interface AgentAvailability {
  agent: AgentKind;
  label: string;
  available: boolean;
  version: string | null;
}

export interface TerminalEvent {
  runId: string;
  kind: 'output' | 'exit';
  data: string | null;
  status: AgentRunStatus | null;
  exitCode: number | null;
}

export interface GithubSyncResult {
  pullRequestCount: number;
  attentionTransitionCount: number;
  completedAt: string;
}

export type SyncTrigger = 'manual' | 'focus' | 'activation' | 'background';

export interface InboxSyncEvent {
  status: 'completed' | 'failed';
  trigger: SyncTrigger;
  result: GithubSyncResult | null;
  error: string | null;
  retryAfterSeconds: number | null;
  attentionPullRequestCount: number;
}

export interface OpenPullRequestEvent {
  pullRequestId: string;
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt';

export type ContextualPrompt =
  'enable_notifications' | 'enable_launch_at_login' | 'attach_local_repository' | 'configure_agent';
