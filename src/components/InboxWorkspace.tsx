import { useMemo, useState } from 'react';
import type { AttentionItem, CachedPullRequest, ContextualPrompt } from '../contracts';
import type { ReviewWorkflowModel } from '../hooks/useReviewWorkflow';
import type { MissionControlClient } from '../lib/client';
import {
  buildInboxEntries,
  formatRelativeTime,
  latestSyncTime,
  type PullRequestInboxEntry,
} from '../lib/inbox';
import { Icon } from './Icon';
import emptyAttention from '../../assets/brand/raster/empty-attention.png';
import { ReviewDetail } from './ReviewDetail';
import { ReasonPill, StatusPill } from './StatusMark';
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
  const entries = useMemo(
    () => buildInboxEntries(pullRequests, attentionItems),
    [attentionItems, pullRequests],
  );
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter(({ pullRequest }) =>
      [pullRequest.title, pullRequest.repository, `#${pullRequest.number}`, pullRequest.authorLogin]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [entries, query]);
  const attentionEntries = filteredEntries.filter((entry) => entry.attention.length > 0);
  const openEntries = filteredEntries.filter((entry) => entry.attention.length === 0);
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
        <aside
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-hairline bg-surface"
          aria-label="Pull requests"
        >
          <header
            className="flex min-h-14 shrink-0 basis-14 items-center justify-between gap-2 border-b border-hairline bg-surface pr-2.5 pl-[88px]"
            data-tauri-drag-region
          >
            <h1 className="m-0 overflow-hidden text-[0.88rem] font-semibold tracking-[-0.015em] text-ellipsis whitespace-nowrap">
              Mission Control
            </h1>
            <div
              className="flex shrink-0 items-center gap-[5px] text-[0.68rem] text-ink-secondary"
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
            <div className="sticky top-0 z-[2] flex items-center gap-3 border-b border-hairline bg-surface p-3 px-4">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-hairline-strong bg-surface-raised px-3 text-ink-muted transition-[border-color,box-shadow] duration-state ease-out focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/10">
                <span className="sr-only">Search pull requests</span>
                <Icon name="search" size={16} />
                <input
                  className="h-9 w-full min-w-0 border-0 bg-transparent p-0 text-[0.8125rem] text-ink outline-none placeholder:text-ink-secondary"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search pull requests"
                />
              </label>
              <span className="shrink-0 text-xs text-ink-muted [font-variant-numeric:tabular-nums]">
                {entries.length} open
              </span>
            </div>

            {!loaded ? <InboxSkeleton /> : null}

            {loaded && entries.length === 0 ? (
              <EmptyInbox onRefresh={onRefresh} refreshing={refreshing} />
            ) : null}

            {loaded && entries.length > 0 && filteredEntries.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-1 p-8 text-center text-ink-muted">
                <Icon name="search" size={19} />
                <strong className="mt-2">No matching pull requests</strong>
                <span className="max-w-[34ch] text-[0.8125rem] text-ink-secondary">
                  Try a repository, author, title, or number.
                </span>
                <button
                  className="mt-3 cursor-pointer border-0 border-b border-current bg-transparent p-0 font-semibold text-ink-secondary"
                  type="button"
                  onClick={() => setQuery('')}
                >
                  Clear search
                </button>
              </div>
            ) : null}

            {attentionEntries.length > 0 ? (
              <InboxGroup title="Needs attention" count={attentionEntries.length} tone="warning">
                {attentionEntries.map((entry) => (
                  <PullRequestRow
                    key={entry.pullRequest.id}
                    entry={entry}
                    selected={selectedEntry?.pullRequest.id === entry.pullRequest.id}
                    onSelect={() => onSelectPullRequest(entry.pullRequest.id)}
                  />
                ))}
              </InboxGroup>
            ) : null}

            {openEntries.length > 0 ? (
              <InboxGroup title="Other open" count={openEntries.length} tone="neutral">
                {openEntries.map((entry) => (
                  <PullRequestRow
                    key={entry.pullRequest.id}
                    entry={entry}
                    selected={selectedEntry?.pullRequest.id === entry.pullRequest.id}
                    onSelect={() => onSelectPullRequest(entry.pullRequest.id)}
                  />
                ))}
              </InboxGroup>
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
          className="min-h-0 min-w-0 overflow-auto bg-[linear-gradient(145deg,oklch(99%_0.006_245/0.76),transparent_46%),var(--canvas)]"
          aria-label="Pull request details"
        >
          {selectedEntry ? (
            <ReviewDetail
              key={selectedEntry.pullRequest.id}
              client={client}
              entry={selectedEntry}
              workflow={reviewWorkflow}
              onOpen={() => onOpenUrl(selectedEntry.pullRequest.url)}
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
            : 'Launch Mission Control when you sign in so background monitoring starts automatically.'}
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

function InboxGroup({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: 'warning' | 'neutral';
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 pt-2 last:pb-3" aria-label={`${title}, ${count}`}>
      <div className={inboxGroupHeadingVariants({ tone })}>
        <span className="grid place-items-center">
          <Icon name={tone === 'warning' ? 'clock' : 'branch'} size={14} />
        </span>
        <strong className="text-[0.8125rem] text-inherit">{title}</strong>
        <span className="min-w-5 rounded-full bg-white/55 px-1.5 py-0.5 text-center text-xs [font-variant-numeric:tabular-nums]">
          {count}
        </span>
      </div>
      <div className="grid gap-px pt-1">{children}</div>
    </section>
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
  const { pullRequest, primaryReason } = entry;
  return (
    <button
      className={cn(
        'grid min-h-[58px] w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border-0 bg-transparent px-3 py-[7px] text-left transition-[background,transform] duration-state ease-out hover:bg-surface-muted active:scale-[0.995]',
        selected && 'bg-surface-selected hover:bg-surface-selected',
      )}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span
        className="grid size-[26px] place-items-center rounded-full border border-hairline bg-surface-raised text-[0.72rem] font-bold text-ink-secondary"
        aria-hidden="true"
      >
        {pullRequest.authorLogin.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="grid min-w-0 gap-[3px]">
        <span className="overflow-hidden text-[0.8125rem] font-semibold text-ellipsis whitespace-nowrap">
          {pullRequest.title}
        </span>
        <span className="overflow-hidden text-[0.72rem] text-ellipsis whitespace-nowrap text-ink-muted">
          {pullRequest.repository} #{pullRequest.number}
        </span>
      </span>
      <span className="grid justify-items-end gap-1">
        {primaryReason ? (
          <ReasonPill reason={primaryReason} compact />
        ) : pullRequest.draft ? (
          <StatusPill tone="neutral" label="Draft" compact />
        ) : (
          <StatusPill tone="success" label="Clear" compact />
        )}
        <span className="text-[0.72rem] text-ink-muted">
          {formatRelativeTime(pullRequest.updatedAt)}
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

const inboxGroupHeadingVariants = cva(
  'grid min-h-[34px] grid-cols-[20px_1fr_auto] items-center gap-2 rounded-md px-3 text-ink-secondary',
  {
    variants: {
      tone: {
        warning: 'bg-warning-soft text-warning-deep',
        neutral: 'bg-surface-muted',
      },
    },
  },
);
