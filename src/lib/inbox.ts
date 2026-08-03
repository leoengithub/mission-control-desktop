import type { AttentionItem, AttentionReason, CachedPullRequest } from '../contracts';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface ReasonPresentation {
  label: string;
  detail: string;
  tone: StatusTone;
}

export interface PullRequestInboxEntry {
  pullRequest: CachedPullRequest;
  attention: AttentionItem[];
  primaryReason: AttentionReason | null;
}

const reasonPriority: AttentionReason[] = [
  'agent_failed',
  'agent_stalled',
  'agent_interrupted',
  'required_checks_failing',
  'unresolved_thread',
  'review_requested',
  'agent_waiting_for_user',
];

export const reasonPresentation: Record<AttentionReason, ReasonPresentation> = {
  review_requested: {
    label: 'Review requested',
    detail: 'Your review is requested',
    tone: 'warning',
  },
  unresolved_thread: {
    label: 'Open thread',
    detail: 'A review conversation needs a response',
    tone: 'warning',
  },
  required_checks_failing: {
    label: 'Checks failing',
    detail: 'One or more required checks are failing',
    tone: 'danger',
  },
  agent_waiting_for_user: {
    label: 'Agent waiting',
    detail: 'An agent needs your input',
    tone: 'info',
  },
  agent_failed: {
    label: 'Agent failed',
    detail: 'An agent run failed',
    tone: 'danger',
  },
  agent_stalled: {
    label: 'Agent stalled',
    detail: 'An agent run stopped making progress',
    tone: 'danger',
  },
  agent_interrupted: {
    label: 'Agent interrupted',
    detail: 'An agent run was interrupted',
    tone: 'warning',
  },
};

function priorityFor(reason: AttentionReason): number {
  return reasonPriority.indexOf(reason);
}

export function buildInboxEntries(
  pullRequests: CachedPullRequest[],
  attentionItems: AttentionItem[],
): PullRequestInboxEntry[] {
  const attentionByPullRequest = new Map<string, AttentionItem[]>();
  for (const item of attentionItems) {
    const current = attentionByPullRequest.get(item.pullRequestId) ?? [];
    current.push(item);
    attentionByPullRequest.set(item.pullRequestId, current);
  }

  return pullRequests
    .map((pullRequest) => {
      const attention = (attentionByPullRequest.get(pullRequest.id) ?? []).sort(
        (left, right) => priorityFor(left.reason) - priorityFor(right.reason),
      );
      return {
        pullRequest,
        attention,
        primaryReason: attention[0]?.reason ?? null,
      };
    })
    .sort((left, right) => {
      if (left.attention.length > 0 && right.attention.length === 0) return -1;
      if (left.attention.length === 0 && right.attention.length > 0) return 1;
      return Date.parse(right.pullRequest.updatedAt) - Date.parse(left.pullRequest.updatedAt);
    });
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.round((now - Date.parse(value)) / 1000));
  if (elapsedSeconds < 45) return 'just now';
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function latestSyncTime(pullRequests: CachedPullRequest[]): string | null {
  return pullRequests.reduce<string | null>((latest, pullRequest) => {
    if (latest === null || Date.parse(pullRequest.lastSyncedAt) > Date.parse(latest)) {
      return pullRequest.lastSyncedAt;
    }
    return latest;
  }, null);
}
