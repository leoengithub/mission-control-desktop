import type { AttentionReason } from '../contracts';
import { reasonPresentation, type StatusTone } from '../lib/inbox';
import agentWaitingIcon from '../../assets/brand/vector/status-agent-waiting.svg';
import approvedIcon from '../../assets/brand/vector/status-approved.svg';
import checksFailingIcon from '../../assets/brand/vector/status-checks-failing.svg';
import needsReviewIcon from '../../assets/brand/vector/status-needs-review.svg';
import syncingIcon from '../../assets/brand/vector/status-syncing.svg';
import threadUnresolvedIcon from '../../assets/brand/vector/status-thread-unresolved.svg';

const toneAsset: Record<StatusTone, string> = {
  success: approvedIcon,
  warning: needsReviewIcon,
  danger: checksFailingIcon,
  info: syncingIcon,
  neutral: threadUnresolvedIcon,
};

const reasonAsset: Record<AttentionReason, string> = {
  review_requested: needsReviewIcon,
  unresolved_thread: threadUnresolvedIcon,
  required_checks_failing: checksFailingIcon,
  agent_waiting_for_user: agentWaitingIcon,
  agent_failed: checksFailingIcon,
  agent_stalled: agentWaitingIcon,
  agent_interrupted: agentWaitingIcon,
};

interface StatusPillProps {
  tone: StatusTone;
  label: string;
  compact?: boolean;
  iconAsset?: string;
}

export function StatusPill({ tone, label, compact = false, iconAsset }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${tone}${compact ? ' status-pill--compact' : ''}`}>
      <span className="status-pill__icon">
        <img src={iconAsset ?? toneAsset[tone]} alt="" aria-hidden="true" />
      </span>
      <span>{label}</span>
    </span>
  );
}

export function ReasonPill({
  reason,
  compact = false,
}: {
  reason: AttentionReason;
  compact?: boolean;
}) {
  const presentation = reasonPresentation[reason];
  return (
    <StatusPill
      tone={presentation.tone}
      label={presentation.label}
      compact={compact}
      iconAsset={reasonAsset[reason]}
    />
  );
}
