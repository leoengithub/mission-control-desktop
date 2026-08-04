import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Copy,
  GitBranch,
  Inbox,
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
  | 'branch'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'copy'
  | 'github'
  | 'inbox'
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
  branch: GitBranch,
  check: Check,
  'chevron-down': ChevronDown,
  clock: Clock3,
  copy: Copy,
  github: CircleUserRound,
  inbox: Inbox,
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
}

export function Icon({ name, size = 16, strokeWidth = 1.8 }: IconProps) {
  const LucideIcon = icons[name];
  return <LucideIcon aria-hidden="true" size={size} strokeWidth={strokeWidth} />;
}
