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

  return (
    <main className="workspace" id="main-content">
      <header className="workspace-header">
        <div>
          <span className="workspace-header__context">Pull request review</span>
          <h1>Reviews</h1>
        </div>
        <div className="sync-summary" aria-live="polite">
          <span className={`sync-summary__dot${refreshing ? ' sync-summary__dot--active' : ''}`} />
          <span>
            {refreshing
              ? 'Checking GitHub'
              : syncTime
                ? `Updated ${formatRelativeTime(syncTime)}`
                : 'Waiting for first sync'}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh inbox"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      {refreshError ? (
        <div className="sync-error" role="alert">
          <Icon name="alert" size={15} />
          <span>GitHub refresh failed. Cached pull requests remain available.</span>
          <button type="button" onClick={onRefresh}>
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

      <div className="workspace-grid">
        <aside className="inbox-pane" aria-label="Pull requests">
          <div className="inbox-toolbar">
            <label className="search-field">
              <span className="sr-only">Search pull requests</span>
              <Icon name="search" size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pull requests"
              />
            </label>
            <span className="inbox-toolbar__count">{entries.length} open</span>
          </div>

          {!loaded ? <InboxSkeleton /> : null}

          {loaded && entries.length === 0 ? (
            <EmptyInbox onRefresh={onRefresh} refreshing={refreshing} />
          ) : null}

          {loaded && entries.length > 0 && filteredEntries.length === 0 ? (
            <div className="no-results">
              <Icon name="search" size={19} />
              <strong>No matching pull requests</strong>
              <span>Try a repository, author, title, or number.</span>
              <button type="button" onClick={() => setQuery('')}>
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
        </aside>

        <section className="detail-pane" aria-label="Pull request details">
          {selectedEntry ? (
            <ReviewDetail
              key={selectedEntry.pullRequest.id}
              client={client}
              entry={selectedEntry}
              githubLogin={githubLogin}
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
    <aside className="contextual-banner" aria-label="Recommended setup">
      <span className="contextual-banner__mark">
        <Icon name={notificationPrompt ? 'alert' : 'sync'} size={16} />
      </span>
      <div className="contextual-banner__copy">
        <strong>
          {notificationPrompt ? 'Know when attention escalates' : 'Monitor from login'}
        </strong>
        <span>
          {notificationPrompt
            ? 'Enable native alerts for new review requests, unresolved threads, and failing required checks.'
            : 'Launch Mission Control when you sign in so background monitoring starts automatically.'}
        </span>
      </div>
      <button className="button button--quiet" type="button" onClick={onEnable}>
        {notificationPrompt ? 'Enable notifications' : 'Enable launch at login'}
      </button>
      <button className="contextual-banner__dismiss" type="button" onClick={onDismiss}>
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
    <section className="inbox-group" aria-label={`${title}, ${count}`}>
      <div className={`inbox-group__heading inbox-group__heading--${tone}`}>
        <span className="inbox-group__mark">
          <Icon name={tone === 'warning' ? 'clock' : 'branch'} size={14} />
        </span>
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      <div className="inbox-group__rows">{children}</div>
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
      className={`pr-row${selected ? ' pr-row--selected' : ''}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="pr-row__avatar" aria-hidden="true">
        {pullRequest.authorLogin.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span className="pr-row__copy">
        <span className="pr-row__title">{pullRequest.title}</span>
        <span className="pr-row__meta">
          {pullRequest.repository} #{pullRequest.number}
        </span>
      </span>
      <span className="pr-row__state">
        {primaryReason ? (
          <ReasonPill reason={primaryReason} compact />
        ) : pullRequest.draft ? (
          <StatusPill tone="neutral" label="Draft" compact />
        ) : (
          <StatusPill tone="success" label="Clear" compact />
        )}
        <span className="pr-row__time">{formatRelativeTime(pullRequest.updatedAt)}</span>
      </span>
    </button>
  );
}

function InboxSkeleton() {
  return (
    <div className="inbox-skeleton" aria-label="Loading cached pull requests">
      <div className="skeleton skeleton--heading" />
      {[0, 1, 2, 3, 4].map((item) => (
        <div className="skeleton-row" key={item}>
          <span className="skeleton skeleton--avatar" />
          <span className="skeleton-row__copy">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--meta" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyInbox({ onRefresh, refreshing }: { onRefresh(): void; refreshing: boolean }) {
  return (
    <div className="empty-inbox">
      <img
        className="empty-inbox__art"
        src={emptyAttention}
        alt=""
        aria-hidden="true"
        decoding="async"
        loading="lazy"
      />
      <strong>Your inbox is clear</strong>
      <span>
        Authored and review-requested pull requests will appear here when GitHub finds them.
      </span>
      <button
        className="button button--quiet"
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <Icon name="refresh" size={15} />
        {refreshing ? 'Checking GitHub' : 'Check GitHub now'}
      </button>
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="detail-placeholder">
      <Icon name="inbox" size={24} />
      <h2>Select a pull request</h2>
      <p>Its attention reasons and current GitHub state will appear here.</p>
    </div>
  );
}
