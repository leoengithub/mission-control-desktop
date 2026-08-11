import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Copy,
  GitBranch,
  GitPullRequest,
  Inbox,
  Info,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'alert'
  | 'arrow-up-right'
  | 'arrow-right'
  | 'arrow-left'
  | 'branch'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'copy'
  | 'github'
  | 'inbox'
  | 'info'
  | 'pull-request'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'spark'
  | 'sync'
  | 'terminal'
  | 'x';

const icons: Record<IconName, LucideIcon> = {
  alert: TriangleAlert,
  'arrow-up-right': ArrowUpRight,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  branch: GitBranch,
  check: Check,
  'chevron-down': ChevronDown,
  clock: Clock3,
  copy: Copy,
  github: CircleUserRound,
  inbox: Inbox,
  info: Info,
  'pull-request': GitPullRequest,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  spark: Sparkles,
  sync: RefreshCw,
  terminal: SquareTerminal,
  x: X,
};

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.8, className }: IconProps) {
  const LucideIcon = icons[name];
  return (
    <LucideIcon
      aria-hidden="true"
      className={className}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
