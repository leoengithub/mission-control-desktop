import { useMemo, useState } from 'react';
import type { AttentionItem, CachedPullRequest, ContextualPrompt } from '../contracts';
import type { ReviewWorkflowModel } from '../hooks/useReviewWorkflow';
import type { MissionControlClient } from '../lib/client';
import {
  buildInboxEntries,
  formatRelativeTime,
  inboxDisposition,
  latestSyncTime,
  type PullRequestInboxEntry,
} from '../lib/inbox';
import { Icon } from './Icon';
import emptyAttention from '../../assets/brand/raster/empty-attention.png';
import { ReviewDetail } from './ReviewDetail';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

interface InboxWorkspaceProps {
  githubLogin: string | null;
  pullRequests: CachedPullRequest[];
  attentionItems: AttentionItem[];
  loaded: boolean;
  refreshing: boolean;
  refreshError: string | null;
  lastCompletedSync: string | null;
  selectedPullRequestId: string | null;
  contextualPrompt: ContextualPrompt | null;
  reviewWorkflow: ReviewWorkflowModel;
  client: MissionControlClient;
  onRefresh(): void;
  onOpenUrl(url: string): void;
  onSelectPullRequest(pullRequestId: string): void;
  onEnableContextualPrompt(prompt: ContextualPrompt): void;
  onDismissContextualPrompt(prompt: ContextualPrompt): void;
  onOpenSettings(): void;
}

type InboxQuickFilter = 'needs_me' | 'ready' | 'drafts' | 'all';

const quickFilters: Array<{ id: InboxQuickFilter; label: string }> = [
  { id: 'needs_me', label: 'Needs me' },
  { id: 'ready', label: 'Ready' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'all', label: 'All' },
];

export function InboxWorkspace({
  githubLogin,
  pullRequests,
  attentionItems,
  loaded,
  refreshing,
  refreshError,
  lastCompletedSync,
  selectedPullRequestId,
  contextualPrompt,
  reviewWorkflow,
  client,
  onRefresh,
  onOpenUrl,
  onSelectPullRequest,
  onEnableContextualPrompt,
  onDismissContextualPrompt,
  onOpenSettings,
}: InboxWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<InboxQuickFilter>('needs_me');
  const entries = useMemo(
    () => buildInboxEntries(pullRequests, attentionItems),
    [attentionItems, pullRequests],
  );
  const searchedEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter(({ pullRequest }) =>
      [pullRequest.title, pullRequest.repository, `#${pullRequest.number}`, pullRequest.authorLogin]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [entries, query]);
  const filterCounts = useMemo(
    () => ({
      needs_me: entries.filter((entry) => entry.attention.length > 0).length,
      ready: entries.filter((entry) => inboxDisposition(entry).kind === 'ready').length,
      drafts: entries.filter((entry) => entry.pullRequest.draft).length,
      all: entries.length,
    }),
    [entries],
  );
  const filteredEntries = useMemo(
    () => searchedEntries.filter((entry) => matchesQuickFilter(entry, quickFilter)),
    [quickFilter, searchedEntries],
  );
  const selectedEntry =
    filteredEntries.find((entry) => entry.pullRequest.id === selectedPullRequestId) ??
    filteredEntries[0] ??
    null;
  const syncTime = lastCompletedSync ?? latestSyncTime(pullRequests);
  const syncLabel = refreshing
    ? 'Checking GitHub'
    : syncTime
      ? `Updated ${formatRelativeTime(syncTime)}`
      : 'Waiting for first sync';
  const compactSyncLabel = refreshing
    ? 'Checking'
    : syncTime
      ? formatRelativeTime(syncTime)
      : 'Waiting';

  return (
    <main
      className="flex min-w-0 flex-1 flex-col bg-[color-mix(in_oklch,var(--canvas)_88%,transparent)]"
      id="main-content"
    >
      {refreshError ? (
        <div
          className="flex min-h-9 items-center gap-2 border-b border-danger/35 bg-danger-soft py-2 pr-6 pl-[88px] text-[0.8125rem] text-danger-deep"
          role="alert"
          data-tauri-drag-region
        >
          <Icon name="alert" size={15} />
          <span>GitHub refresh failed. Cached pull requests remain available.</span>
          <button
            className="ml-auto cursor-pointer border-0 border-b border-current bg-transparent p-0 font-semibold text-inherit"
            type="button"
            onClick={onRefresh}
          >
            Retry
          </button>
        </div>
      ) : null}

      {contextualPrompt ? (
        <ContextualSetupBanner
          prompt={contextualPrompt}
          onEnable={() => onEnableContextualPrompt(contextualPrompt)}
          onDismiss={() => onDismissContextualPrompt(contextualPrompt)}
        />
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(330px,370px)_minmax(0,1fr)] max-[1120px]:grid-cols-[340px_minmax(0,1fr)] max-[980px]:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-label="Pull requests">
          <header
            className="flex min-h-11 shrink-0 basis-11 items-center justify-between gap-2 border-b border-hairline pr-2.5 pl-4"
            data-tauri-drag-region
          >
            <h1 className="m-0 overflow-hidden text-[0.88rem] font-semibold tracking-[-0.015em] text-ellipsis whitespace-nowrap">
              Captain
            </h1>
            <div
              className="flex shrink-0 items-center gap-1.5 text-xs text-ink-secondary"
              aria-live="polite"
            >
              <span
                className={cn(
                  'size-[7px] rounded-full border-2 border-success',
                  refreshing && 'animate-spin border-warning border-t-transparent',
                )}
              />
              <span className="sr-only">{syncLabel}</span>
              <span aria-hidden="true">{compactSyncLabel}</span>
              <button
                className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-sm bg-transparent text-ink-secondary transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.94]"
                type="button"
                aria-label="Refresh inbox"
                onClick={onRefresh}
                disabled={refreshing}
              >
                <Icon name="refresh" size={15} />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-[2] grid gap-2 border-b border-hairline bg-canvas px-4 py-3">
              <label className="flex min-w-0 items-center gap-2 rounded-sm border border-hairline-strong bg-surface-raised px-3 text-ink-muted transition-[border-color,box-shadow] duration-state ease-out focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/12">
                <span className="sr-only">Search pull requests</span>
                <Icon name="search" size={16} />
                <input
                  data-composite-input
                  className="h-9 w-full min-w-0 border-0 bg-transparent p-0 text-[0.8125rem] text-ink outline-none placeholder:text-ink-secondary"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search pull requests"
                />
              </label>
              <div
                className="grid grid-cols-[1.25fr_repeat(3,1fr)] gap-1 rounded-md bg-surface-muted p-1"
                role="group"
                aria-label="Quick filters"
              >
                {quickFilters.map((filter) => {
                  const active = quickFilter === filter.id;
                  return (
                    <button
                      className={cn(
                        'flex min-w-0 cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent bg-transparent px-1 py-1.5 text-xs font-semibold text-ink-secondary transition-[background,color,border-color] duration-state ease-out hover:text-ink',
                        active && 'border border-hairline bg-surface-raised text-ink',
                      )}
                      key={filter.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setQuickFilter(filter.id)}
                    >
                      <span className="whitespace-nowrap">{filter.label}</span>
                      <span className="shrink-0 text-xs text-ink-muted [font-variant-numeric:tabular-nums]">
                        {filterCounts[filter.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!loaded ? <InboxSkeleton /> : null}

            {loaded && entries.length === 0 ? (
              <EmptyInbox onRefresh={onRefresh} refreshing={refreshing} />
            ) : null}

            {loaded && entries.length > 0 && filteredEntries.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-1 p-8 text-center text-ink-muted">
                <Icon name={query ? 'search' : 'inbox'} size={19} />
                <strong className="mt-2">
                  {query ? 'No matching pull requests' : 'Nothing in this filter'}
                </strong>
                <span className="max-w-[34ch] text-[0.8125rem] text-ink-secondary">
                  {query
                    ? 'Try an author, title, number, or repository.'
                    : 'Choose All to see every pull request in the review desk.'}
                </span>
                <button
                  className="mt-3 cursor-pointer border-0 border-b border-current bg-transparent p-0 font-semibold text-ink-secondary"
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setQuickFilter('all');
                  }}
                >
                  {query ? 'Clear search and filters' : 'Show all'}
                </button>
              </div>
            ) : null}

            {loaded && filteredEntries.length > 0 ? (
              <div className="flex flex-col">
                {filteredEntries.map((entry) => (
                  <PullRequestRow
                    key={entry.pullRequest.id}
                    entry={entry}
                    selected={selectedEntry?.pullRequest.id === entry.pullRequest.id}
                    onSelect={() => onSelectPullRequest(entry.pullRequest.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <footer className="flex min-h-[62px] items-center gap-2 border-t border-hairline p-2 px-3">
            <button
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-surface-muted"
              type="button"
              onClick={onOpenSettings}
            >
              <span
                className="grid size-[30px] shrink-0 place-items-center rounded-full border border-hairline-strong bg-surface-raised text-ink-secondary"
                aria-hidden="true"
              >
                <Icon name="github" size={16} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <strong className="overflow-hidden text-[0.78rem] text-ellipsis whitespace-nowrap">
                  {githubLogin ? `@${githubLogin}` : 'GitHub account'}
                </strong>
              </span>
            </button>
            <button
              className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-sm bg-transparent text-ink-secondary transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.94]"
              type="button"
              aria-label="Open settings"
              onClick={onOpenSettings}
            >
              <Icon name="settings" size={17} />
            </button>
          </footer>
        </aside>

        <section
          className="relative z-[1] my-2 mr-2 min-h-0 min-w-0 overflow-auto rounded-lg border border-surface-raised bg-surface shadow-panel"
          aria-label="Pull request details"
        >
          {selectedEntry ? (
            <ReviewDetail
              key={selectedEntry.pullRequest.id}
              client={client}
              entry={selectedEntry}
              workflow={reviewWorkflow}
              onOpenUrl={onOpenUrl}
            />
          ) : (
            <DetailPlaceholder />
          )}
        </section>
      </div>
    </main>
  );
}

function ContextualSetupBanner({
  prompt,
  onEnable,
  onDismiss,
}: {
  prompt: ContextualPrompt;
  onEnable(): void;
  onDismiss(): void;
}) {
  const notificationPrompt = prompt === 'enable_notifications';
  return (
    <aside
      className="flex min-h-[54px] items-center gap-3 border-b border-warning/55 bg-warning-soft py-2.5 pr-6 pl-[88px]"
      aria-label="Recommended setup"
      data-tauri-drag-region
    >
      <span className="grid size-[30px] shrink-0 place-items-center rounded-full border border-warning/50 bg-surface text-warning-deep">
        <Icon name={notificationPrompt ? 'alert' : 'sync'} size={16} />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <strong className="text-[0.8125rem]">
          {notificationPrompt ? 'Know when attention escalates' : 'Monitor from login'}
        </strong>
        <span className="text-xs text-ink-secondary max-[980px]:hidden">
          {notificationPrompt
            ? 'Enable native alerts for new review requests, unresolved threads, and failing required checks.'
            : 'Launch Captain when you sign in so background monitoring starts automatically.'}
        </span>
      </div>
      <Button className="shrink-0" variant="outline" type="button" onClick={onEnable}>
        {notificationPrompt ? 'Enable notifications' : 'Enable launch at login'}
      </Button>
      <button
        className="cursor-pointer border-0 border-b border-current bg-transparent px-0 py-1 text-xs font-semibold text-ink-secondary"
        type="button"
        onClick={onDismiss}
      >
        Not now
      </button>
    </aside>
  );
}

function PullRequestRow({
  entry,
  selected,
  onSelect,
}: {
  entry: PullRequestInboxEntry;
  selected: boolean;
  onSelect(): void;
}) {
  const { pullRequest } = entry;
  const disposition = inboxDisposition(entry);
  return (
    <button
      className={cn(
        'grid min-h-[60px] w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5 border-0 border-b border-hairline bg-transparent px-3.5 py-2 text-left transition-[background,transform] duration-state ease-out last:border-b-0 hover:bg-surface-muted active:scale-[0.995]',
        selected && 'bg-surface-selected hover:bg-surface-selected',
      )}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`#${pullRequest.number} ${pullRequest.title}, ${pullRequest.additions} additions, ${pullRequest.deletions} deletions, ${disposition.label}`}
    >
      <span className={dispositionMarkVariants({ tone: disposition.tone })} aria-hidden="true">
        <Icon name="pull-request" size={16} strokeWidth={2} />
      </span>
      <span className="grid min-w-0 gap-1.5">
        <span className="flex min-w-0 items-baseline gap-1.5 leading-tight">
          <span className="shrink-0 text-xs font-semibold text-ink-muted [font-variant-numeric:tabular-nums]">
            #{pullRequest.number}
          </span>
          <span className="overflow-hidden text-[0.8125rem] font-semibold tracking-[-0.008em] text-ellipsis whitespace-nowrap text-ink">
            {pullRequest.title}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs leading-none text-ink-muted">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            @{pullRequest.authorLogin} · {formatRelativeTime(pullRequest.updatedAt)}
          </span>
          <span
            className="flex shrink-0 items-center gap-1.5 font-semibold [font-variant-numeric:tabular-nums]"
            aria-hidden="true"
          >
            <span className="text-success-deep" aria-hidden="true">
              +{pullRequest.additions}
            </span>
            <span className="text-danger-deep" aria-hidden="true">
              −{pullRequest.deletions}
            </span>
          </span>
          <span className={dispositionLabelVariants({ tone: disposition.tone })}>
            {disposition.label}
          </span>
        </span>
      </span>
    </button>
  );
}

function InboxSkeleton() {
  return (
    <div className="p-4" aria-label="Loading cached pull requests">
      <div className="relative mb-3 block h-[30px] w-[45%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
      {[0, 1, 2, 3, 4].map((item) => (
        <div
          className="flex h-[62px] items-center gap-3 border-b-2 border-surface bg-surface-muted p-3"
          key={item}
        >
          <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
          <span className="grid w-full gap-2">
            <span className="relative h-[9px] w-[78%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
            <span className="relative h-[7px] w-[42%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyInbox({ onRefresh, refreshing }: { onRefresh(): void; refreshing: boolean }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 p-8 text-center">
      <img
        className="aspect-video w-[min(100%,250px)] rounded-md border border-hairline object-cover"
        src={emptyAttention}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
      />
      <strong>Your inbox is clear</strong>
      <span className="max-w-[34ch] text-[0.8125rem] text-ink-secondary">
        Authored and review-requested pull requests will appear here when GitHub finds them.
      </span>
      <Button
        className="mt-3"
        variant="outline"
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <Icon name="refresh" size={15} />
        {refreshing ? 'Checking GitHub' : 'Check GitHub now'}
      </Button>
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center text-ink-muted">
      <Icon name="inbox" size={24} />
      <h2 className="mt-2 text-base text-ink">Select a pull request</h2>
      <p className="m-0 max-w-[34ch] text-[0.8125rem] text-ink-secondary">
        Its attention reasons and current GitHub state will appear here.
      </p>
    </div>
  );
}

function matchesQuickFilter(entry: PullRequestInboxEntry, filter: InboxQuickFilter): boolean {
  if (filter === 'needs_me') return entry.attention.length > 0;
  if (filter === 'ready') return inboxDisposition(entry).kind === 'ready';
  if (filter === 'drafts') return entry.pullRequest.draft;
  return true;
}

const dispositionMarkVariants = cva('grid size-5 shrink-0 place-items-center', {
  variants: {
    tone: {
      success: 'text-success-deep',
      warning: 'text-warning-deep',
      danger: 'text-danger',
      info: 'text-info-deep',
      neutral: 'text-ink-muted',
    },
  },
});

const dispositionLabelVariants = cva(
  'inline-flex min-h-[18px] shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 text-xs font-semibold leading-none',
  {
    variants: {
      tone: {
        success: 'border-success/40 bg-success-soft text-success-deep',
        warning: 'border-warning/40 bg-warning-soft text-warning-deep',
        danger: 'border-danger/35 bg-danger-soft text-danger-deep',
        info: 'border-info/35 bg-info-soft text-info-deep',
        neutral: 'border-hairline-strong bg-surface-muted text-ink-secondary',
      },
    },
  },
);
