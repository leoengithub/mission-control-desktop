import { useMemo, useState } from 'react';
import type { AttentionItem, CachedPullRequest } from '../contracts';
import {
  buildInboxEntries,
  formatRelativeTime,
  latestSyncTime,
  reasonPresentation,
  type PullRequestInboxEntry,
} from '../lib/inbox';
import { Icon } from './Icon';
import { ReasonPill, StatusPill } from './StatusMark';

interface InboxWorkspaceProps {
  githubLogin: string | null;
  pullRequests: CachedPullRequest[];
  attentionItems: AttentionItem[];
  loaded: boolean;
  refreshing: boolean;
  refreshError: string | null;
  lastCompletedSync: string | null;
  onRefresh(): void;
  onOpenUrl(url: string): void;
}

export function InboxWorkspace({
  githubLogin,
  pullRequests,
  attentionItems,
  loaded,
  refreshing,
  refreshError,
  lastCompletedSync,
  onRefresh,
  onOpenUrl,
}: InboxWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    filteredEntries.find((entry) => entry.pullRequest.id === selectedId) ??
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
                  onSelect={() => setSelectedId(entry.pullRequest.id)}
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
                  onSelect={() => setSelectedId(entry.pullRequest.id)}
                />
              ))}
            </InboxGroup>
          ) : null}
        </aside>

        <section className="detail-pane" aria-label="Pull request details">
          {selectedEntry ? (
            <PullRequestDetail
              entry={selectedEntry}
              githubLogin={githubLogin}
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

function PullRequestDetail({
  entry,
  githubLogin,
  onOpen,
}: {
  entry: PullRequestInboxEntry;
  githubLogin: string | null;
  onOpen(): void;
}) {
  const { pullRequest, attention } = entry;
  const isAuthored =
    githubLogin?.toLocaleLowerCase() === pullRequest.authorLogin.toLocaleLowerCase();
  return (
    <article className="pr-detail">
      <header className="pr-detail__header">
        <div className="pr-detail__identity">
          <div className="pr-detail__overline">
            {entry.primaryReason ? (
              <ReasonPill reason={entry.primaryReason} />
            ) : (
              <StatusPill tone="success" label="No active escalation" />
            )}
            {pullRequest.draft ? <StatusPill tone="neutral" label="Draft" /> : null}
            <span>
              {pullRequest.repository} #{pullRequest.number}
            </span>
          </div>
          <h2>{pullRequest.title}</h2>
          <div className="pr-detail__metadata">
            <span>
              <Icon name="branch" size={14} />
              {pullRequest.headSha.slice(0, 7)}
            </span>
            <span>Authored by @{pullRequest.authorLogin}</span>
            <span>Updated {formatRelativeTime(pullRequest.updatedAt)}</span>
          </div>
        </div>
        <button className="button button--primary" type="button" onClick={onOpen}>
          Open on GitHub
          <Icon name="arrow-up-right" size={15} />
        </button>
      </header>

      <div className="pr-detail__summary">
        <div>
          <span className="section-label">Attention summary</span>
          <h3>
            {attention.length > 0
              ? `${attention.length} active ${attention.length === 1 ? 'reason' : 'reasons'}`
              : 'Nothing is asking for you right now'}
          </h3>
        </div>
        <div className="pr-detail__role">
          <span>{isAuthored ? 'Your pull request' : 'Reviewing'}</span>
          <strong>{isAuthored ? 'Author' : 'Reviewer'}</strong>
        </div>
      </div>

      {attention.length > 0 ? (
        <div className="attention-list">
          {attention.map((item) => {
            const presentation = reasonPresentation[item.reason];
            return (
              <section className="attention-row" key={item.id}>
                <div className={`attention-row__mark attention-row__mark--${presentation.tone}`}>
                  <Icon
                    name={
                      presentation.tone === 'danger'
                        ? 'x'
                        : presentation.tone === 'warning'
                          ? 'clock'
                          : 'spark'
                    }
                    size={16}
                    strokeWidth={2.2}
                  />
                </div>
                <div className="attention-row__content">
                  <div className="attention-row__heading">
                    <h4>{presentation.label}</h4>
                    <span>{formatRelativeTime(item.lastChangedAt)}</span>
                  </div>
                  <p>{item.summary || presentation.detail}</p>
                  <span className="attention-row__source">
                    {item.sourceId ? 'GitHub review thread' : 'GitHub pull request state'}
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="clear-state">
          <span className="clear-state__mark">
            <Icon name="check" size={21} strokeWidth={2.2} />
          </span>
          <div>
            <h3>Up to date</h3>
            <p>
              Mission Control is still monitoring this pull request for new review activity and
              required-check failures.
            </p>
          </div>
        </div>
      )}

      <footer className="pr-detail__footer">
        <span>
          <Icon name="sync" size={14} />
          Cached locally and monitored in the background
        </span>
        <span>Last synchronized {formatRelativeTime(pullRequest.lastSyncedAt)}</span>
      </footer>
    </article>
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
      <span className="empty-inbox__mark">
        <Icon name="inbox" size={22} />
      </span>
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
