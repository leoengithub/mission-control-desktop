import type {
  ActivationState,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorizationPoll,
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
    headSha: 'b2178f9',
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
    headSha: '7f30a2c',
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
    headSha: 'd991ab1',
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
    headSha: '24e410e',
    draft: true,
    reviewRequested: false,
    updatedAt: minutesAgo(90),
    lastSyncedAt: minutesAgo(1),
  },
];

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
          initialSyncCompleted: false,
        }
      : {
          step: 'ready',
          githubLogin: 'leo',
          accessibleRepositoryCount: 18,
          initialSyncCompleted: true,
        };
  let authorizationPolls = 0;

  return {
    async getFoundationStatus() {
      await wait(40);
      return {
        settingsSchemaVersion: 1,
        databaseSchemaVersion: 1,
        githubAppConfigured: true,
        actionablePollSeconds: 60,
        discoveryPollSeconds: 300,
      };
    },
    async getActivationState() {
      await wait(80);
      return activation;
    },
    async listAttentionItems() {
      await wait(80);
      return preview === 'empty' ? [] : previewAttention;
    },
    async listPullRequests() {
      await wait(80);
      return preview === 'empty' ? [] : previewPullRequests;
    },
    async refreshInbox() {
      await wait(700);
      activation = {
        step: 'ready',
        githubLogin: 'leo',
        accessibleRepositoryCount: 18,
        initialSyncCompleted: true,
      };
      return {
        pullRequestCount: previewPullRequests.length,
        attentionTransitionCount: previewAttention.length,
        completedAt: new Date().toISOString(),
      };
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
        initialSyncCompleted: false,
      };
      return { state: 'authorized', login: 'leo', avatarUrl: '' };
    },
    async openExternalUrl() {
      await wait(20);
    },
  };
}
