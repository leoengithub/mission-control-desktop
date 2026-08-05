import type {
  ActivationState,
  AppSettings,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorizationPoll,
  InboxSyncEvent,
  OpenPullRequestEvent,
  SettingsPatch,
  AgentRun,
  LocalRepositoryAttachment,
  PullRequestReviewDetail,
  TerminalEvent,
} from '../contracts';
import type { MissionControlClient } from './client';

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const previewPullRequests: CachedPullRequest[] = [
  {
    id: 'pr-390',
    repository: 'tembo-io/monorepo',
    number: 390,
    title: 'feat: show one tool call at a time during agent thinking',
    url: 'https://github.com/tembo-io/monorepo/pull/390',
    authorLogin: 'leo',
    headRef: 'feat/agent-thinking',
    headSha: 'b2178f9',
    baseRef: 'main',
    draft: false,
    reviewRequested: false,
    updatedAt: minutesAgo(3),
    lastSyncedAt: minutesAgo(1),
  },
  {
    id: 'pr-412',
    repository: 'revolico/web',
    number: 412,
    title: 'Improve account query boundaries',
    url: 'https://github.com/revolico/web/pull/412',
    authorLogin: 'leo',
    headRef: 'feat/account-query-boundaries',
    headSha: '7f30a2c',
    baseRef: 'main',
    draft: false,
    reviewRequested: false,
    updatedAt: minutesAgo(18),
    lastSyncedAt: minutesAgo(1),
  },
  {
    id: 'pr-88',
    repository: 'mission-control/desktop',
    number: 88,
    title: 'Add cached inbox reconciliation',
    url: 'https://github.com/mission-control/desktop/pull/88',
    authorLogin: 'marina',
    headRef: 'feat/cached-inbox',
    headSha: 'd991ab1',
    baseRef: 'main',
    draft: false,
    reviewRequested: true,
    updatedAt: minutesAgo(42),
    lastSyncedAt: minutesAgo(1),
  },
  {
    id: 'pr-73',
    repository: 'mission-control/desktop',
    number: 73,
    title: 'Refine native notification routing',
    url: 'https://github.com/mission-control/desktop/pull/73',
    authorLogin: 'leo',
    headRef: 'feat/notification-routing',
    headSha: '24e410e',
    baseRef: 'main',
    draft: true,
    reviewRequested: false,
    updatedAt: minutesAgo(90),
    lastSyncedAt: minutesAgo(1),
  },
];

const previewReviewDetails: Record<string, PullRequestReviewDetail> = {
  'pr-390': {
    pullRequestId: 'pr-390',
    threads: [
      {
        id: 'thread-390',
        path: 'src/agent/session.ts',
        line: 118,
        startLine: null,
        originalLine: 116,
        originalStartLine: null,
        side: 'RIGHT',
        resolved: false,
        outdated: false,
        isBot: false,
        hasNewActivity: true,
        updatedAt: minutesAgo(3),
        comments: [
          {
            id: 'comment-390',
            authorLogin: 'marina',
            body: 'This session can remain marked active when the transport closes before the final event. Can we make cleanup unconditional?',
            isBot: false,
            diffHunk: '@@ -112,8 +116,12 @@ async function closeSession() {',
            createdAt: minutesAgo(12),
            updatedAt: minutesAgo(3),
          },
        ],
      },
    ],
    checks: [
      {
        id: 'check-e2e',
        name: 'E2E Tests',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        required: true,
        detailsUrl: 'https://github.com/tembo-io/monorepo/actions',
        updatedAt: minutesAgo(4),
      },
      {
        id: 'check-type',
        name: 'Typecheck',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        required: true,
        detailsUrl: null,
        updatedAt: minutesAgo(6),
      },
    ],
  },
  'pr-412': {
    pullRequestId: 'pr-412',
    threads: [
      {
        id: 'thread-1',
        path: 'src/graphql/account.ts',
        line: 42,
        startLine: 37,
        originalLine: 42,
        originalStartLine: 37,
        side: 'RIGHT',
        resolved: false,
        outdated: false,
        isBot: true,
        hasNewActivity: true,
        updatedAt: minutesAgo(18),
        comments: [
          {
            id: 'comment-1',
            authorLogin: 'codex-review[bot]',
            body: 'The account header query still requests a seller-only field. This can fail for buyer profiles and should be moved behind the seller fragment.',
            isBot: true,
            diffHunk: '@@ -38,7 +38,6 @@ query AccountHeader {',
            createdAt: minutesAgo(31),
            updatedAt: minutesAgo(18),
          },
        ],
      },
    ],
    checks: [],
  },
};

const emptyDetail = (pullRequestId: string): PullRequestReviewDetail => ({
  pullRequestId,
  threads: [],
  checks: [],
});

const previewAttention: AttentionItem[] = [
  {
    id: 'attention-checks',
    pullRequestId: 'pr-390',
    reason: 'required_checks_failing',
    sourceId: null,
    summary: 'Required checks failing: E2E, Typecheck, and 2 more',
    firstDetectedAt: minutesAgo(17),
    lastChangedAt: minutesAgo(3),
    snoozedUntil: null,
  },
  {
    id: 'attention-thread',
    pullRequestId: 'pr-412',
    reason: 'unresolved_thread',
    sourceId: 'thread-1',
    summary: 'Unresolved review thread on Improve account query boundaries',
    firstDetectedAt: minutesAgo(31),
    lastChangedAt: minutesAgo(18),
    snoozedUntil: null,
  },
  {
    id: 'attention-review',
    pullRequestId: 'pr-88',
    reason: 'review_requested',
    sourceId: null,
    summary: 'Review requested: Add cached inbox reconciliation',
    firstDetectedAt: minutesAgo(42),
    lastChangedAt: minutesAgo(42),
    snoozedUntil: null,
  },
];

const wait = (milliseconds = 180) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function createPreviewClient(preview: string | null): MissionControlClient {
  let activation: ActivationState =
    preview === 'onboarding'
      ? {
          step: 'github_authorization_required',
          githubLogin: null,
          accessibleRepositoryCount: 0,
          repositorySelectionCompleted: false,
          initialSyncCompleted: false,
        }
      : {
          step: 'ready',
          githubLogin: 'leo',
          accessibleRepositoryCount: 18,
          repositorySelectionCompleted: true,
          initialSyncCompleted: true,
        };
  let authorizationPolls = 0;
  let settings: AppSettings = {
    schemaVersion: 1,
    general: { launchAtLogin: false, closeBehavior: 'menu_bar', theme: 'system' },
    sync: { preset: 'balanced' },
    notifications: {
      enabled: false,
      reviewRequested: true,
      unresolvedThread: true,
      requiredChecksFailing: true,
      agentWaitingForUser: true,
      agentFailed: true,
      agentStalled: true,
      agentInterrupted: true,
    },
    agents: {
      defaultAgent: null,
      codexPermissionBypass: false,
      claudePermissionBypass: false,
    },
    worktrees: { baseDirectory: null, cleanupPolicy: 'safe_only' },
    storage: {
      diffCacheMaxBytes: 250 * 1024 * 1024,
      diffCacheRetentionDays: 7,
      completedRunLogRetentionDays: 30,
    },
    updates: { automaticChecks: true, channel: 'stable' },
    dismissedContextualPrompts: [],
  };
  const inboxSyncHandlers = new Set<(event: InboxSyncEvent) => void>();
  const openPullRequestHandlers = new Set<(event: OpenPullRequestEvent) => void>();
  const terminalHandlers = new Set<(event: TerminalEvent) => void>();
  const runs: AgentRun[] = [];
  let repositories: LocalRepositoryAttachment[] = [
    {
      repositoryId: 'repo-tembo',
      repository: 'tembo-io/monorepo',
      monitored: true,
      localPath: '/Users/leo/Work/tembo/monorepo',
      defaultBranch: 'main',
      validationState: 'valid',
      lastValidatedAt: minutesAgo(20),
    },
    {
      repositoryId: 'repo-revolico',
      repository: 'revolico/web',
      monitored: true,
      localPath: null,
      defaultBranch: 'main',
      validationState: 'not_attached',
      lastValidatedAt: null,
    },
    {
      repositoryId: 'repo-mission-control',
      repository: 'mission-control/desktop',
      monitored: true,
      localPath: null,
      defaultBranch: 'main',
      validationState: 'not_attached',
      lastValidatedAt: null,
    },
  ];

  const mergeSettings = (patch: SettingsPatch): AppSettings => {
    settings = { ...settings, ...patch };
    return settings;
  };

  return {
    async getFoundationStatus() {
      await wait(40);
      return {
        settingsSchemaVersion: 1,
        databaseSchemaVersion: 3,
        githubAppConfigured: true,
        actionablePollSeconds: 60,
        discoveryPollSeconds: 300,
      };
    },
    async getActivationState() {
      await wait(80);
      return activation;
    },
    async getSettings() {
      await wait(40);
      return settings;
    },
    async updateSettings(patch) {
      await wait(180);
      return mergeSettings(patch);
    },
    async getNotificationPermission() {
      await wait(30);
      return 'granted';
    },
    async requestNotificationPermission() {
      await wait(120);
      return 'granted';
    },
    async listContextualPrompts() {
      await wait(30);
      if (settings.dismissedContextualPrompts.includes('enable_notifications')) return [];
      if (!settings.notifications.enabled && previewAttention.length > 0) {
        return ['enable_notifications'];
      }
      if (settings.notifications.enabled && !settings.general.launchAtLogin) {
        return ['enable_launch_at_login'];
      }
      return [];
    },
    async listAttentionItems() {
      await wait(80);
      if (preview === 'empty') return [];
      const monitoredRepositories = new Set(
        repositories
          .filter((repository) => repository.monitored)
          .map((repository) => repository.repository),
      );
      const visiblePullRequestIds = new Set(
        previewPullRequests
          .filter((pullRequest) => monitoredRepositories.has(pullRequest.repository))
          .map((pullRequest) => pullRequest.id),
      );
      return previewAttention.filter((item) => visiblePullRequestIds.has(item.pullRequestId));
    },
    async listPullRequests() {
      await wait(80);
      if (preview === 'empty') return [];
      const monitoredRepositories = new Set(
        repositories
          .filter((repository) => repository.monitored)
          .map((repository) => repository.repository),
      );
      return previewPullRequests.filter((pullRequest) =>
        monitoredRepositories.has(pullRequest.repository),
      );
    },
    async getPullRequestReviewDetail(pullRequestId) {
      await wait(90);
      return previewReviewDetails[pullRequestId] ?? emptyDetail(pullRequestId);
    },
    async markPullRequestSeen() {
      await wait(20);
    },
    async listLocalRepositories() {
      await wait(60);
      return repositories;
    },
    async attachLocalRepository(repositoryId, localPath) {
      await wait(220);
      const current = repositories.find((repository) => repository.repositoryId === repositoryId);
      const attached: LocalRepositoryAttachment = {
        repositoryId,
        repository: current?.repository ?? 'owner/repository',
        monitored: current?.monitored ?? true,
        localPath,
        defaultBranch: current?.defaultBranch ?? 'main',
        validationState: 'valid',
        lastValidatedAt: new Date().toISOString(),
      };
      repositories = [
        ...repositories.filter((repository) => repository.repositoryId !== repositoryId),
        attached,
      ];
      return attached;
    },
    async setRepositoryMonitoring(repositoryIds) {
      await wait(180);
      const selected = new Set(repositoryIds);
      repositories = repositories.map((repository) => ({
        ...repository,
        monitored: selected.has(repository.repositoryId),
      }));
      activation = { ...activation, repositorySelectionCompleted: true };
      return repositories;
    },
    async detectAgents() {
      await wait(80);
      return [
        { agent: 'codex', label: 'Codex', available: true, version: 'codex 0.122.0' },
        { agent: 'claude_code', label: 'Claude Code', available: true, version: '2.1.0' },
      ];
    },
    async listAgentRuns(pullRequestId) {
      await wait(60);
      return runs.filter((run) => run.pullRequestId === pullRequestId);
    },
    async readAgentRunLog(runId) {
      await wait(30);
      return `$ Mission Control session ${runId.slice(0, 8)}\nInspecting the review thread...\n`;
    },
    async requestCopilotReview() {
      await wait(280);
    },
    async replyAndResolve(threadId, selectedAgent) {
      await wait(420);
      const pullRequestId =
        Object.values(previewReviewDetails).find((detail) =>
          detail.threads.some((thread) => thread.id === threadId),
        )?.pullRequestId ?? 'pr-390';
      const run = previewRun(pullRequestId, threadId, selectedAgent, 'reply_resolve', 'completed');
      run.replyPostedAt = new Date().toISOString();
      run.resolvedAt = run.replyPostedAt;
      run.summary = 'Reply posted and review thread resolved';
      runs.unshift(run);
      return run;
    },
    async startFixSession(threadId, selectedAgent) {
      const pullRequestId =
        Object.values(previewReviewDetails).find((detail) =>
          detail.threads.some((thread) => thread.id === threadId),
        )?.pullRequestId ?? 'pr-390';
      const run = previewRun(pullRequestId, threadId, selectedAgent, 'fix_reply_resolve');
      runs.unshift(run);
      simulateTerminal(run.id, terminalHandlers);
      return run;
    },
    async openThreadTerminal(threadId) {
      const pullRequestId =
        Object.values(previewReviewDetails).find((detail) =>
          detail.threads.some((thread) => thread.id === threadId),
        )?.pullRequestId ?? 'pr-390';
      const run = previewRun(pullRequestId, threadId, 'shell', 'open_terminal');
      runs.unshift(run);
      simulateTerminal(run.id, terminalHandlers);
      return run;
    },
    async terminalInput() {
      await wait(10);
    },
    async terminalResize() {
      await wait(10);
    },
    async terminateAgentRun(runId) {
      const run = runs.find((item) => item.id === runId);
      if (run) run.status = 'interrupted';
    },
    async completeFixSession(runId) {
      const run = runs.find((item) => item.id === runId);
      if (!run) throw new Error('Agent run not found');
      run.status = 'completed';
      run.endedAt = new Date().toISOString();
      run.replyPostedAt = run.endedAt;
      run.resolvedAt = run.endedAt;
      run.summary = 'Reply posted and review thread resolved. Worktree preserved with changes.';
      return run;
    },
    async cleanupAgentWorktree() {
      await wait(80);
    },
    async onTerminalEvent(handler) {
      terminalHandlers.add(handler);
      return () => terminalHandlers.delete(handler);
    },
    async refreshInbox(trigger = 'manual') {
      await wait(700);
      activation = {
        step: activation.repositorySelectionCompleted ? 'ready' : 'repository_selection_required',
        githubLogin: 'leo',
        accessibleRepositoryCount: repositories.length,
        repositorySelectionCompleted: activation.repositorySelectionCompleted,
        initialSyncCompleted: activation.repositorySelectionCompleted,
      };
      const result = {
        pullRequestCount: previewPullRequests.length,
        attentionTransitionCount: previewAttention.length,
        completedAt: new Date().toISOString(),
      };
      const event: InboxSyncEvent = {
        status: 'completed',
        trigger,
        result,
        error: null,
        retryAfterSeconds: null,
        attentionPullRequestCount: previewAttention.length,
      };
      inboxSyncHandlers.forEach((handler) => handler(event));
      return result;
    },
    async onInboxSync(handler) {
      inboxSyncHandlers.add(handler);
      return () => inboxSyncHandlers.delete(handler);
    },
    async onOpenPullRequest(handler) {
      openPullRequestHandlers.add(handler);
      return () => openPullRequestHandlers.delete(handler);
    },
    async startGithubAuthorization() {
      await wait(260);
      return {
        sessionId: 'preview-session',
        userCode: 'MC5D-92LK',
        verificationUri: 'https://github.com/login/device',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        pollIntervalSeconds: 1,
      };
    },
    async pollGithubAuthorization(): Promise<DeviceAuthorizationPoll> {
      await wait(220);
      authorizationPolls += 1;
      if (authorizationPolls < 2) {
        return { state: 'pending', retryAfterSeconds: 1 };
      }
      activation = {
        step: 'repository_access_required',
        githubLogin: 'leo',
        accessibleRepositoryCount: 0,
        repositorySelectionCompleted: false,
        initialSyncCompleted: false,
      };
      return { state: 'authorized', login: 'leo', avatarUrl: '' };
    },
    async cancelGithubAuthorization() {
      authorizationPolls = 0;
      await wait(40);
    },
    async disconnectGithubAccount() {
      await wait(180);
      authorizationPolls = 0;
      activation = {
        step: 'github_authorization_required',
        githubLogin: null,
        accessibleRepositoryCount: 0,
        repositorySelectionCompleted: false,
        initialSyncCompleted: false,
      };
      return activation;
    },
    async openExternalUrl() {
      await wait(20);
    },
  };
}

function previewRun(
  pullRequestId: string,
  threadId: string,
  agent: AgentRun['agent'],
  action: AgentRun['action'],
  status: AgentRun['status'] = 'running',
): AgentRun {
  return {
    id: crypto.randomUUID(),
    pullRequestId,
    threadId,
    action,
    agent,
    status,
    worktreePath: `/tmp/mission-control/${pullRequestId}`,
    baseHeadSha: 'b2178f9',
    logPath: `/tmp/mission-control/${pullRequestId}.log`,
    startedAt: new Date().toISOString(),
    endedAt: status === 'running' ? null : new Date().toISOString(),
    summary: null,
    exitCode: status === 'running' ? null : 0,
    replyPostedAt: null,
    resolvedAt: null,
  };
}

function simulateTerminal(runId: string, handlers: Set<(event: TerminalEvent) => void>) {
  window.setTimeout(() => {
    handlers.forEach((handler) =>
      handler({
        runId,
        kind: 'output',
        data: '\u001b[1;32mMission Control\u001b[0m opened the isolated worktree.\r\n',
        status: 'running',
        exitCode: null,
      }),
    );
  }, 220);
}
