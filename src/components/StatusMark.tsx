import type { AttentionReason } from '../contracts';
import { reasonPresentation, type StatusTone } from '../lib/inbox';
import agentWaitingIcon from '../../assets/brand/vector/status-agent-waiting.svg';
import approvedIcon from '../../assets/brand/vector/status-approved.svg';
import checksFailingIcon from '../../assets/brand/vector/status-checks-failing.svg';
import needsReviewIcon from '../../assets/brand/vector/status-needs-review.svg';
import syncingIcon from '../../assets/brand/vector/status-syncing.svg';
import threadUnresolvedIcon from '../../assets/brand/vector/status-thread-unresolved.svg';
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

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
    <span className={statusPillVariants({ tone, compact })}>
      <span className="grid place-items-center">
        <img
          className={cn(compact ? 'size-3' : 'size-3.5')}
          src={iconAsset ?? toneAsset[tone]}
          alt=""
          aria-hidden="true"
        />
      </span>
      <span>{label}</span>
    </span>
  );
}

const statusPillVariants = cva(
  'inline-flex w-fit items-center whitespace-nowrap rounded-full border font-semibold leading-none',
  {
    variants: {
      tone: {
        success: 'border-success/45 bg-success-soft text-success-deep',
        warning: 'border-warning/45 bg-warning-soft text-warning-deep',
        danger: 'border-danger/40 bg-danger-soft text-danger-deep',
        info: 'border-info/35 bg-info-soft text-info-deep',
        neutral: 'border-hairline-strong bg-surface-muted text-ink-secondary',
      },
      compact: {
        false: 'min-h-[26px] gap-1.5 py-0 pr-[9px] pl-[7px] text-xs',
        true: 'min-h-5 gap-1 py-0 pr-[7px] pl-[5px] text-[0.66rem]',
      },
    },
    defaultVariants: { compact: false },
  },
);

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
