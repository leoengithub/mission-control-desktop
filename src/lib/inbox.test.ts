import { describe, expect, it } from 'vitest';
import type { AttentionItem, CachedPullRequest } from '../contracts';
import { buildInboxEntries, formatRelativeTime, inboxDisposition, latestSyncTime } from './inbox';

const pullRequest = (id: string, minutesAgo: number): CachedPullRequest => ({
  id,
  repository: 'owner/repo',
  number: Number(id.replace(/\D/g, '')),
  title: `Pull request ${id}`,
  url: `https://example.test/${id}`,
  authorLogin: 'owner',
  headRef: 'feature/review-flow',
  headSha: 'abcdef0',
  baseRef: 'main',
  draft: false,
  reviewRequested: false,
  mergeStateStatus: 'UNKNOWN',
  reviewDecision: null,
  bodyText: 'A factual pull request description.',
  changedFiles: 3,
  additions: 24,
  deletions: 7,
  updatedAt: new Date(Date.UTC(2026, 7, 3, 12, -minutesAgo)).toISOString(),
  lastSyncedAt: new Date(Date.UTC(2026, 7, 3, 12, -minutesAgo)).toISOString(),
});

const attention = (pullRequestId: string, reason: AttentionItem['reason']): AttentionItem => ({
  id: `${pullRequestId}-${reason}`,
  pullRequestId,
  reason,
  sourceId: null,
  summary: reason,
  firstDetectedAt: '2026-08-03T12:00:00Z',
  lastChangedAt: '2026-08-03T12:00:00Z',
  snoozedUntil: null,
});

describe('buildInboxEntries', () => {
  it('puts actionable pull requests first and chooses the highest-priority reason', () => {
    const entries = buildInboxEntries(
      [pullRequest('pr-1', 1), pullRequest('pr-2', 10)],
      [attention('pr-2', 'unresolved_thread'), attention('pr-2', 'required_checks_failing')],
    );

    expect(entries.map((entry) => entry.pullRequest.id)).toEqual(['pr-2', 'pr-1']);
    expect(entries[0]?.primaryReason).toBe('required_checks_failing');
  });

  it('lets personal attention override merge readiness', () => {
    const readyPullRequest = {
      ...pullRequest('pr-3', 2),
      mergeStateStatus: 'CLEAN' as const,
      reviewDecision: 'APPROVED' as const,
    };
    const [entry] = buildInboxEntries([readyPullRequest], [attention('pr-3', 'unresolved_thread')]);

    expect(entry && inboxDisposition(entry)).toMatchObject({
      kind: 'thread',
      label: '1 thread',
    });
  });

  it('uses GitHub clean state for the ready disposition', () => {
    const readyPullRequest = {
      ...pullRequest('pr-4', 2),
      mergeStateStatus: 'CLEAN' as const,
      reviewDecision: 'APPROVED' as const,
    };
    const [entry] = buildInboxEntries([readyPullRequest], []);

    expect(entry && inboxDisposition(entry)).toMatchObject({ kind: 'ready', label: 'Ready' });
  });
});

describe('time helpers', () => {
  it('formats compact relative time and finds the newest sync', () => {
    const now = Date.UTC(2026, 7, 3, 12, 0, 0);
    expect(formatRelativeTime('2026-08-03T11:42:00Z', now)).toBe('18m ago');
    expect(latestSyncTime([pullRequest('pr-1', 8), pullRequest('pr-2', 2)])).toBe(
      '2026-08-03T11:58:00.000Z',
    );
  });
});
