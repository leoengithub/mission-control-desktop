import type { CheckRun } from '../contracts';
import type { PullRequestInboxEntry, StatusTone } from './inbox';

export type ReviewDetailTab = 'overview' | 'threads' | 'checks' | 'runs';

export interface OverviewSignal {
  id: 'threads' | 'checks' | 'review' | 'merge';
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
  target: ReviewDetailTab | null;
}

export function buildOverviewSignals(
  entry: PullRequestInboxEntry,
  checks: CheckRun[],
  openThreadCount: number,
): OverviewSignal[] {
  const requiredChecks = checks.filter((check) => check.required);
  const failingRequired = requiredChecks.filter((check) => checkTone(check) === 'danger').length;
  const pendingRequired = requiredChecks.filter((check) => checkTone(check) === 'warning').length;

  const checksSignal: OverviewSignal = failingRequired
    ? {
        id: 'checks',
        label: 'Required checks',
        value: `${failingRequired} failing`,
        detail: 'GitHub reports a required check failure.',
        tone: 'danger',
        target: 'checks',
      }
    : pendingRequired
      ? {
          id: 'checks',
          label: 'Required checks',
          value: `${pendingRequired} pending`,
          detail: 'GitHub is still running required checks.',
          tone: 'warning',
          target: 'checks',
        }
      : requiredChecks.length
        ? {
            id: 'checks',
            label: 'Required checks',
            value: `${requiredChecks.length} passing`,
            detail: 'All reported required checks are successful.',
            tone: 'success',
            target: 'checks',
          }
        : {
            id: 'checks',
            label: 'Required checks',
            value: 'None reported',
            detail: 'GitHub did not identify any required checks.',
            tone: 'neutral',
            target: 'checks',
          };

  return [
    {
      id: 'threads',
      label: 'Review threads',
      value: openThreadCount ? `${openThreadCount} open` : 'Clear',
      detail: openThreadCount
        ? 'One or more review conversations still need attention.'
        : 'No unresolved, current review threads are cached.',
      tone: openThreadCount ? 'warning' : 'success',
      target: 'threads',
    },
    checksSignal,
    reviewSignal(entry),
    mergeSignal(entry),
  ];
}

export function checkTone(check: CheckRun): 'danger' | 'warning' | 'success' | 'neutral' {
  const conclusion = check.conclusion?.toUpperCase();
  if (
    ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(
      conclusion ?? '',
    )
  ) {
    return 'danger';
  }
  if (
    check.status.toUpperCase() !== 'COMPLETED' ||
    ['CANCELLED', 'STALE'].includes(conclusion ?? '')
  ) {
    return 'warning';
  }
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
    return 'success';
  }
  return 'neutral';
}

function reviewSignal(entry: PullRequestInboxEntry): OverviewSignal {
  const decision = entry.pullRequest.reviewDecision;
  if (decision === 'APPROVED') {
    return {
      id: 'review',
      label: 'Review decision',
      value: 'Approved',
      detail: 'GitHub reports an approved review decision.',
      tone: 'success',
      target: null,
    };
  }
  if (decision === 'CHANGES_REQUESTED') {
    return {
      id: 'review',
      label: 'Review decision',
      value: 'Changes requested',
      detail: 'A reviewer has requested changes.',
      tone: 'danger',
      target: 'threads',
    };
  }
  if (decision === 'REVIEW_REQUIRED') {
    return {
      id: 'review',
      label: 'Review decision',
      value: 'Review required',
      detail: 'GitHub requires an approving review.',
      tone: 'warning',
      target: 'threads',
    };
  }
  return {
    id: 'review',
    label: 'Review decision',
    value: 'No decision',
    detail: 'GitHub has not reported a review decision.',
    tone: 'neutral',
    target: null,
  };
}

function mergeSignal(entry: PullRequestInboxEntry): OverviewSignal {
  const status = entry.pullRequest.mergeStateStatus;
  const presentation: Record<
    typeof status,
    Pick<OverviewSignal, 'value' | 'detail' | 'tone'>
  > = {
    CLEAN: {
      value: 'Ready',
      detail: 'GitHub reports that the pull request can merge cleanly.',
      tone: 'success',
    },
    DIRTY: {
      value: 'Conflicts',
      detail: 'The branch has merge conflicts.',
      tone: 'danger',
    },
    UNSTABLE: {
      value: 'Checks unstable',
      detail: 'The merge is blocked by an unstable status.',
      tone: 'danger',
    },
    BEHIND: {
      value: 'Behind base',
      detail: 'The branch is behind its base branch.',
      tone: 'warning',
    },
    BLOCKED: {
      value: 'Blocked',
      detail: 'A GitHub merge requirement is not satisfied.',
      tone: 'warning',
    },
    HAS_HOOKS: {
      value: 'Waiting',
      detail: 'GitHub is waiting for merge hooks to complete.',
      tone: 'warning',
    },
    UNKNOWN: {
      value: 'Checking',
      detail: 'GitHub has not finished calculating merge readiness.',
      tone: 'neutral',
    },
  };

  return {
    id: 'merge',
    label: 'Merge state',
    ...presentation[status],
    target: status === 'UNSTABLE' ? 'checks' : null,
  };
}
