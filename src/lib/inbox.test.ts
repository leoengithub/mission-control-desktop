import { describe, expect, it } from 'vitest';
import type { AttentionItem, CachedPullRequest } from '../contracts';
import { buildInboxEntries, formatRelativeTime, latestSyncTime } from './inbox';

const pullRequest = (id: string, minutesAgo: number): CachedPullRequest => ({
  id,
  repository: 'owner/repo',
  number: Number(id.replace(/\D/g, '')),
  title: `Pull request ${id}`,
  url: `https://example.test/${id}`,
  authorLogin: 'owner',
  headSha: 'abcdef0',
  draft: false,
  reviewRequested: false,
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
