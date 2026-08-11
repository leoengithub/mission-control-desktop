import { describe, expect, it } from 'vitest';
import type { CachedPullRequest, CheckRun } from '../contracts';
import type { PullRequestInboxEntry } from './inbox';
import { buildOverviewSignals } from './reviewOverview';

const pullRequest: CachedPullRequest = {
  id: 'pr-1',
  repository: 'owner/repo',
  number: 1,
  title: 'Review factual overview',
  url: 'https://github.com/owner/repo/pull/1',
  authorLogin: 'owner',
  headRef: 'feature/overview',
  headSha: 'abcdef0',
  baseRef: 'main',
  draft: false,
  reviewRequested: false,
  mergeStateStatus: 'UNSTABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  bodyText: 'Explain the change.',
  changedFiles: 4,
  additions: 42,
  deletions: 7,
  updatedAt: '2026-08-11T08:00:00Z',
  lastSyncedAt: '2026-08-11T08:01:00Z',
};

const entry = (reason: PullRequestInboxEntry['primaryReason']): PullRequestInboxEntry => ({
  pullRequest,
  attention: [],
  primaryReason: reason,
});

const requiredFailure: CheckRun = {
  id: 'check-1',
  name: 'Typecheck',
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  required: true,
  detailsUrl: null,
  updatedAt: '2026-08-11T08:00:00Z',
};

describe('review overview presentation', () => {
  it('builds four factual signals and routes supporting evidence', () => {
    const signals = buildOverviewSignals(entry('required_checks_failing'), [requiredFailure], 2);

    expect(signals).toHaveLength(4);
    expect(signals.find((signal) => signal.id === 'threads')).toMatchObject({
      value: '2 open',
      target: 'threads',
    });
    expect(signals.find((signal) => signal.id === 'checks')).toMatchObject({
      value: '1 failing',
      tone: 'danger',
      target: 'checks',
    });
    expect(signals.find((signal) => signal.id === 'review')?.value).toBe('Review required');
    expect(signals.find((signal) => signal.id === 'merge')?.value).toBe('Checks unstable');
  });
});
