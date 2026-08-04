import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ActivationState,
  AppSettings,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorization,
  DeviceAuthorizationPoll,
  FoundationStatus,
  GithubSyncResult,
  InboxSyncEvent,
  NotificationPermission,
  OpenPullRequestEvent,
  SettingsPatch,
  SyncTrigger,
  ContextualPrompt,
  AgentAvailability,
  AgentKind,
  AgentRun,
  LocalRepositoryAttachment,
  PullRequestReviewDetail,
  TerminalEvent,
} from '../contracts';

const INBOX_SYNC_EVENT = 'mission-control://inbox-sync';
const OPEN_PULL_REQUEST_EVENT = 'mission-control://open-pull-request';
const TERMINAL_EVENT = 'mission-control://terminal';

export function getFoundationStatus(): Promise<FoundationStatus> {
  return invoke<FoundationStatus>('get_foundation_status');
}

export function getActivationState(): Promise<ActivationState> {
  return invoke<ActivationState>('get_activation_state');
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  return invoke<AppSettings>('update_settings', { patch });
}

export function getNotificationPermission(): Promise<NotificationPermission> {
  return invoke<NotificationPermission>('get_notification_permission');
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  return invoke<NotificationPermission>('request_notification_permission');
}

export function listContextualPrompts(): Promise<ContextualPrompt[]> {
  return invoke<ContextualPrompt[]>('list_contextual_prompts');
}

export function listAttentionItems(): Promise<AttentionItem[]> {
  return invoke<AttentionItem[]>('list_attention_items');
}

export function listPullRequests(): Promise<CachedPullRequest[]> {
  return invoke<CachedPullRequest[]>('list_pull_requests');
}

export function getPullRequestReviewDetail(
  pullRequestId: string,
): Promise<PullRequestReviewDetail> {
  return invoke<PullRequestReviewDetail>('get_pull_request_review_detail', { pullRequestId });
}

export function markPullRequestSeen(pullRequestId: string): Promise<void> {
  return invoke<void>('mark_pull_request_seen', { pullRequestId });
}

export function listLocalRepositories(): Promise<LocalRepositoryAttachment[]> {
  return invoke<LocalRepositoryAttachment[]>('list_local_repositories');
}

export function attachLocalRepository(
  repositoryId: string,
  localPath: string,
): Promise<LocalRepositoryAttachment> {
  return invoke<LocalRepositoryAttachment>('attach_local_repository', { repositoryId, localPath });
}

export function detectAgents(): Promise<AgentAvailability[]> {
  return invoke<AgentAvailability[]>('detect_agents');
}

export function listAgentRuns(pullRequestId: string): Promise<AgentRun[]> {
  return invoke<AgentRun[]>('list_agent_runs', { pullRequestId });
}

export function readAgentRunLog(runId: string): Promise<string> {
  return invoke<string>('read_agent_run_log', { runId });
}

export function requestCopilotReview(pullRequestId: string): Promise<void> {
  return invoke<void>('request_copilot_review', { pullRequestId });
}

export function replyAndResolve(
  threadId: string,
  selectedAgent: AgentKind,
  existingRunId?: string,
): Promise<AgentRun> {
  return invoke<AgentRun>('reply_and_resolve', {
    threadId,
    selectedAgent,
    existingRunId: existingRunId ?? null,
  });
}

export function startFixSession(threadId: string, selectedAgent: AgentKind): Promise<AgentRun> {
  return invoke<AgentRun>('start_fix_session', { threadId, selectedAgent });
}

export function openThreadTerminal(threadId: string): Promise<AgentRun> {
  return invoke<AgentRun>('open_thread_terminal', { threadId });
}

export function terminalInput(runId: string, data: string): Promise<void> {
  return invoke<void>('terminal_input', { runId, data });
}

export function terminalResize(runId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('terminal_resize', { runId, cols, rows });
}

export function terminateAgentRun(runId: string): Promise<void> {
  return invoke<void>('terminate_agent_run', { runId });
}

export function completeFixSession(runId: string): Promise<AgentRun> {
  return invoke<AgentRun>('complete_fix_session', { runId });
}

export function cleanupAgentWorktree(runId: string): Promise<void> {
  return invoke<void>('cleanup_agent_worktree', { runId });
}

export function onTerminalEvent(handler: (event: TerminalEvent) => void): Promise<() => void> {
  return listen<TerminalEvent>(TERMINAL_EVENT, (event) => handler(event.payload));
}

export function refreshInbox(trigger: SyncTrigger = 'manual'): Promise<GithubSyncResult> {
  return invoke<GithubSyncResult>('refresh_inbox', { trigger });
}

export function onInboxSync(handler: (event: InboxSyncEvent) => void): Promise<() => void> {
  return listen<InboxSyncEvent>(INBOX_SYNC_EVENT, (event) => handler(event.payload));
}

export function onOpenPullRequest(
  handler: (event: OpenPullRequestEvent) => void,
): Promise<() => void> {
  return listen<OpenPullRequestEvent>(OPEN_PULL_REQUEST_EVENT, (event) => handler(event.payload));
}

export function startGithubAuthorization(): Promise<DeviceAuthorization> {
  return invoke<DeviceAuthorization>('start_github_authorization');
}

export function pollGithubAuthorization(sessionId: string): Promise<DeviceAuthorizationPoll> {
  return invoke<DeviceAuthorizationPoll>('poll_github_authorization', { sessionId });
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke<void>('plugin:opener|open_url', { url });
}
