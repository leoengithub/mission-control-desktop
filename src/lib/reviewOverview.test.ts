import { describe, expect, it } from 'vitest';
import type { CachedPullRequest, CheckRun } from '../contracts';
import type { PullRequestInboxEntry } from './inbox';
import { buildOverviewSignals, checkTone } from './reviewOverview';

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

const check = (overrides: Partial<CheckRun>): CheckRun => ({
  id: 'check-test',
  name: 'Test check',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  required: true,
  detailsUrl: null,
  updatedAt: '2026-08-11T08:00:00Z',
  ...overrides,
});

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

  it('summarizes three successful required StatusContexts as passing', () => {
    const statuses = ['E2E', 'ESLint', 'Unit test'].map((name) =>
      check({ id: name, name, status: 'SUCCESS', conclusion: 'SUCCESS' }),
    );

    expect(
      buildOverviewSignals(entry('required_checks_failing'), statuses, 0).find(
        (signal) => signal.id === 'checks',
      ),
    ).toMatchObject({ value: '3 passing', tone: 'success' });
  });

  it('counts only required checks when optional checks fail', () => {
    const signals = buildOverviewSignals(
      entry('required_checks_failing'),
      [
        check({ id: 'required', name: 'Required', status: 'SUCCESS', conclusion: 'SUCCESS' }),
        check({ id: 'optional', name: 'Optional', required: false, conclusion: 'FAILURE' }),
      ],
      0,
    );

    expect(signals.find((signal) => signal.id === 'checks')).toMatchObject({
      value: '1 passing',
      tone: 'success',
    });
  });

  it('reports only genuinely running required checks as pending', () => {
    const signals = buildOverviewSignals(
      entry('required_checks_failing'),
      [
        check({ id: 'success', name: 'Success', status: 'SUCCESS', conclusion: 'SUCCESS' }),
        check({ id: 'pending', name: 'Pending', status: 'PENDING', conclusion: 'PENDING' }),
      ],
      0,
    );

    expect(signals.find((signal) => signal.id === 'checks')).toMatchObject({
      value: '1 pending',
      tone: 'warning',
    });
  });

  it('treats persisted StatusContext success as terminal success', () => {
    expect(checkTone(check({ status: 'SUCCESS', conclusion: 'SUCCESS' }))).toBe('success');
  });

  it('keeps StatusContext pending and CheckRun execution states pending', () => {
    expect(checkTone(check({ status: 'PENDING', conclusion: 'PENDING' }))).toBe('warning');
    expect(checkTone(check({ status: 'IN_PROGRESS', conclusion: null }))).toBe('warning');
    expect(checkTone(check({ status: 'QUEUED', conclusion: null }))).toBe('warning');
  });

  it('keeps terminal cancellation and staleness failing, while unknown is neutral', () => {
    expect(checkTone(check({ conclusion: 'CANCELLED' }))).toBe('danger');
    expect(checkTone(check({ conclusion: 'STALE' }))).toBe('danger');
    expect(checkTone(check({ conclusion: 'SOMETHING_NEW' }))).toBe('neutral');
    expect(checkTone(check({ status: 'UNKNOWN', conclusion: 'UNKNOWN' }))).toBe('neutral');
    expect(checkTone(check({ conclusion: 'NEUTRAL' }))).toBe('success');
    expect(checkTone(check({ conclusion: 'SKIPPED' }))).toBe('success');
    expect(checkTone(check({ conclusion: null }))).toBe('neutral');
  });

  it('does not count an unknown required state as passing', () => {
    const signals = buildOverviewSignals(
      entry('required_checks_failing'),
      [
        check({ id: 'success', name: 'Success', status: 'SUCCESS', conclusion: 'SUCCESS' }),
        check({ id: 'unknown', name: 'Unknown', conclusion: 'SOMETHING_NEW' }),
      ],
      0,
    );

    expect(signals.find((signal) => signal.id === 'checks')).toMatchObject({
      value: '1 unknown',
      tone: 'neutral',
    });
  });
});
