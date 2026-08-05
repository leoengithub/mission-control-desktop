import type {
  ActivationState,
  AttentionItem,
  AppSettings,
  CachedPullRequest,
  ContextualPrompt,
  DeviceAuthorization,
  DeviceAuthorizationPoll,
  FoundationStatus,
  GithubSyncResult,
  InboxSyncEvent,
  NotificationPermission,
  OpenPullRequestEvent,
  SettingsPatch,
  SyncTrigger,
  AgentAvailability,
  AgentKind,
  AgentRun,
  LocalRepositoryAttachment,
  PullRequestReviewDetail,
  TerminalEvent,
} from '../contracts';
import {
  attachLocalRepository,
  cancelGithubAuthorization,
  cleanupAgentWorktree,
  completeFixSession,
  detectAgents,
  disconnectGithubAccount,
  getActivationState,
  getFoundationStatus,
  getNotificationPermission,
  getSettings,
  getPullRequestReviewDetail,
  listAttentionItems,
  listContextualPrompts,
  listPullRequests,
  listAgentRuns,
  listLocalRepositories,
  markPullRequestSeen,
  onInboxSync,
  onOpenPullRequest,
  onTerminalEvent,
  openThreadTerminal,
  openExternalUrl,
  pollGithubAuthorization,
  refreshInbox,
  requestNotificationPermission,
  requestCopilotReview,
  replyAndResolve,
  readAgentRunLog,
  startFixSession,
  startGithubAuthorization,
  setRepositoryMonitoring,
  updateSettings,
  terminalInput,
  terminalResize,
  terminateAgentRun,
} from './missionControl';
import { createPreviewClient } from './previewClient';

export interface MissionControlClient {
  getFoundationStatus(): Promise<FoundationStatus>;
  getActivationState(): Promise<ActivationState>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: SettingsPatch): Promise<AppSettings>;
  getNotificationPermission(): Promise<NotificationPermission>;
  requestNotificationPermission(): Promise<NotificationPermission>;
  listContextualPrompts(): Promise<ContextualPrompt[]>;
  listAttentionItems(): Promise<AttentionItem[]>;
  listPullRequests(): Promise<CachedPullRequest[]>;
  getPullRequestReviewDetail(pullRequestId: string): Promise<PullRequestReviewDetail>;
  markPullRequestSeen(pullRequestId: string): Promise<void>;
  listLocalRepositories(): Promise<LocalRepositoryAttachment[]>;
  attachLocalRepository(
    repositoryId: string,
    localPath: string,
  ): Promise<LocalRepositoryAttachment>;
  setRepositoryMonitoring(repositoryIds: string[]): Promise<LocalRepositoryAttachment[]>;
  detectAgents(): Promise<AgentAvailability[]>;
  listAgentRuns(pullRequestId: string): Promise<AgentRun[]>;
  readAgentRunLog(runId: string): Promise<string>;
  requestCopilotReview(pullRequestId: string): Promise<void>;
  replyAndResolve(
    threadId: string,
    selectedAgent: AgentKind,
    existingRunId?: string,
  ): Promise<AgentRun>;
  startFixSession(threadId: string, selectedAgent: AgentKind): Promise<AgentRun>;
  openThreadTerminal(threadId: string): Promise<AgentRun>;
  terminalInput(runId: string, data: string): Promise<void>;
  terminalResize(runId: string, cols: number, rows: number): Promise<void>;
  terminateAgentRun(runId: string): Promise<void>;
  completeFixSession(runId: string): Promise<AgentRun>;
  cleanupAgentWorktree(runId: string): Promise<void>;
  onTerminalEvent(handler: (event: TerminalEvent) => void): Promise<() => void>;
  refreshInbox(trigger?: SyncTrigger): Promise<GithubSyncResult>;
  onInboxSync(handler: (event: InboxSyncEvent) => void): Promise<() => void>;
  onOpenPullRequest(handler: (event: OpenPullRequestEvent) => void): Promise<() => void>;
  startGithubAuthorization(): Promise<DeviceAuthorization>;
  pollGithubAuthorization(sessionId: string): Promise<DeviceAuthorizationPoll>;
  cancelGithubAuthorization(sessionId: string): Promise<void>;
  disconnectGithubAccount(): Promise<ActivationState>;
  openExternalUrl(url: string): Promise<void>;
}

const nativeClient: MissionControlClient = {
  getFoundationStatus,
  getActivationState,
  getSettings,
  updateSettings,
  getNotificationPermission,
  requestNotificationPermission,
  listContextualPrompts,
  listAttentionItems,
  listPullRequests,
  getPullRequestReviewDetail,
  markPullRequestSeen,
  listLocalRepositories,
  attachLocalRepository,
  setRepositoryMonitoring,
  detectAgents,
  listAgentRuns,
  readAgentRunLog,
  requestCopilotReview,
  replyAndResolve,
  startFixSession,
  openThreadTerminal,
  terminalInput,
  terminalResize,
  terminateAgentRun,
  completeFixSession,
  cleanupAgentWorktree,
  onTerminalEvent,
  refreshInbox,
  onInboxSync,
  onOpenPullRequest,
  startGithubAuthorization,
  pollGithubAuthorization,
  cancelGithubAuthorization,
  disconnectGithubAccount,
  openExternalUrl,
};

export function createMissionControlClient(): MissionControlClient {
  const hasTauriRuntime = '__TAURI_INTERNALS__' in window;
  if (import.meta.env.DEV && !hasTauriRuntime) {
    return createPreviewClient(new URLSearchParams(window.location.search).get('preview'));
  }
  return nativeClient;
}
