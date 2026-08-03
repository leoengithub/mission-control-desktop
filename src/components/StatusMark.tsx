import type { AttentionReason } from '../contracts';
import { reasonPresentation, type StatusTone } from '../lib/inbox';
import { Icon, type IconName } from './Icon';

const toneIcon: Record<StatusTone, IconName> = {
  success: 'check',
  warning: 'clock',
  danger: 'x',
  info: 'spark',
  neutral: 'branch',
};

interface StatusPillProps {
  tone: StatusTone;
  label: string;
  compact?: boolean;
}

export function StatusPill({ tone, label, compact = false }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${tone}${compact ? ' status-pill--compact' : ''}`}>
      <span className="status-pill__icon">
        <Icon name={toneIcon[tone]} size={compact ? 12 : 14} strokeWidth={2.2} />
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
  return <StatusPill tone={presentation.tone} label={presentation.label} compact={compact} />;
}
