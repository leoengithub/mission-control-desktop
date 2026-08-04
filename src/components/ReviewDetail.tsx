import { useMemo, useState } from 'react';
import type { AgentKind, AgentRun, CheckRun, ReviewThread } from '../contracts';
import type { ReviewWorkflowModel } from '../hooks/useReviewWorkflow';
import type { MissionControlClient } from '../lib/client';
import { formatRelativeTime, type PullRequestInboxEntry } from '../lib/inbox';
import { Icon } from './Icon';
import { ReasonPill, StatusPill } from './StatusMark';
import { TerminalPanel } from './TerminalPanel';

type DetailTab = 'threads' | 'checks' | 'runs';

interface ReviewDetailProps {
  client: MissionControlClient;
  entry: PullRequestInboxEntry;
  githubLogin: string | null;
  workflow: ReviewWorkflowModel;
  onOpen(): void;
}

export function ReviewDetail({ client, entry, githubLogin, workflow, onOpen }: ReviewDetailProps) {
  const [tab, setTab] = useState<DetailTab>('threads');
  const { pullRequest, attention } = entry;
  const isAuthored =
    githubLogin?.toLocaleLowerCase() === pullRequest.authorLogin.toLocaleLowerCase();
  const detail = workflow.detail?.pullRequestId === pullRequest.id ? workflow.detail : null;
  const openThreads =
    detail?.threads.filter((thread) => !thread.resolved && !thread.outdated) ?? [];
  const failedChecks = detail?.checks.filter((check) => checkTone(check) === 'danger').length ?? 0;
  const attachedRepository = workflow.repositories.find(
    (repository) => repository.repository === pullRequest.repository,
  );
  const copilotKey = `copilot:${pullRequest.id}`;

  return (
    <article className="pr-detail pr-detail--review">
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
              {pullRequest.headRef} → {pullRequest.baseRef}
            </span>
            <span>Authored by @{pullRequest.authorLogin}</span>
            <span>Updated {formatRelativeTime(pullRequest.updatedAt)}</span>
          </div>
        </div>
        <div className="pr-detail__header-actions">
          <button
            className="button button--quiet"
            type="button"
            disabled={workflow.actionStates[copilotKey] === 'running'}
            onClick={() => void workflow.requestCopilotReview()}
          >
            <Icon name="spark" size={15} />
            {workflow.actionStates[copilotKey] === 'running'
              ? 'Requesting…'
              : 'Request Copilot review'}
          </button>
          <button className="button button--primary" type="button" onClick={onOpen}>
            Open on GitHub
            <Icon name="arrow-up-right" size={15} />
          </button>
        </div>
      </header>

      <div className="review-command-bar">
        <div className="review-command-bar__role">
          <span className="section-label">Workspace</span>
          <strong>{isAuthored ? 'Your pull request' : 'Requested review'}</strong>
          <span
            className={
              attachedRepository?.localPath ? 'repo-state repo-state--ready' : 'repo-state'
            }
          >
            <Icon name={attachedRepository?.localPath ? 'check' : 'alert'} size={13} />
            {attachedRepository?.localPath
              ? 'Local repository attached'
              : 'Local actions need setup'}
          </span>
        </div>
        <label className="agent-select">
          <span>Local agent</span>
          <select
            value={workflow.selectedAgent ?? ''}
            onChange={(event) => workflow.setSelectedAgent(event.target.value as AgentKind)}
          >
            {workflow.selectedAgent ? null : <option value="">No local agent available</option>}
            {workflow.agents.map((agent) => (
              <option disabled={!agent.available} value={agent.agent} key={agent.agent}>
                {agent.label} {agent.available ? '' : '(not installed)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {workflow.detailError ? (
        <div className="detail-inline-error" role="alert">
          <Icon name="alert" size={15} />
          <span>{workflow.detailError}</span>
          <button type="button" onClick={() => void workflow.reload()}>
            Retry
          </button>
        </div>
      ) : null}
      {workflow.actionErrors[copilotKey] ? (
        <div className="detail-inline-error" role="alert">
          <Icon name="alert" size={15} />
          <span>{workflow.actionErrors[copilotKey]}</span>
        </div>
      ) : null}

      <nav className="detail-tabs" aria-label="Pull request detail sections">
        <DetailTabButton
          active={tab === 'threads'}
          label="Review threads"
          count={openThreads.length}
          onClick={() => setTab('threads')}
        />
        <DetailTabButton
          active={tab === 'checks'}
          label="Checks"
          count={detail?.checks.length ?? 0}
          alertCount={failedChecks}
          onClick={() => setTab('checks')}
        />
        <DetailTabButton
          active={tab === 'runs'}
          label="Agent runs"
          count={workflow.runs.length}
          onClick={() => setTab('runs')}
        />
      </nav>

      <div className="review-content" aria-busy={workflow.detailLoading}>
        {workflow.detailLoading && !detail ? <DetailSkeleton /> : null}
        {!workflow.detailLoading && tab === 'threads' ? (
          <ThreadsView
            threads={detail?.threads ?? []}
            attentionCount={attention.length}
            workflow={workflow}
          />
        ) : null}
        {!workflow.detailLoading && tab === 'checks' ? (
          <ChecksView checks={detail?.checks ?? []} />
        ) : null}
        {!workflow.detailLoading && tab === 'runs' ? (
          <RunsView runs={workflow.runs} workflow={workflow} />
        ) : null}
      </div>

      {workflow.activeRun ? (
        <TerminalPanel
          key={workflow.activeRun.id}
          client={client}
          run={workflow.activeRun}
          actionBusy={workflow.actionStates[`run:${workflow.activeRun.id}`] === 'running'}
          actionError={workflow.actionErrors[`run:${workflow.activeRun.id}`] ?? null}
          onClose={() => workflow.setActiveRun(null)}
          onComplete={(runId) => void workflow.completeFixSession(runId)}
        />
      ) : null}

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

function DetailTabButton({
  active,
  label,
  count,
  alertCount = 0,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  alertCount?: number;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={active ? 'detail-tab detail-tab--active' : 'detail-tab'}
      onClick={onClick}
    >
      <span>{label}</span>
      <span
        className={
          alertCount > 0 ? 'detail-tab__count detail-tab__count--alert' : 'detail-tab__count'
        }
      >
        {alertCount > 0 ? `${alertCount} failing` : count}
      </span>
    </button>
  );
}

function ThreadsView({
  threads,
  attentionCount,
  workflow,
}: {
  threads: ReviewThread[];
  attentionCount: number;
  workflow: ReviewWorkflowModel;
}) {
  const active = threads.filter((thread) => !thread.resolved && !thread.outdated);
  const resolved = threads.filter((thread) => thread.resolved || thread.outdated);
  if (threads.length === 0) {
    return <ReviewClearState attentionCount={attentionCount} />;
  }
  return (
    <div className="thread-groups">
      <section className="thread-group" aria-label="Open review threads">
        <header>
          <div>
            <span className="thread-group__status thread-group__status--open">
              <Icon name="clock" size={14} /> Open
            </span>
            <h3>
              {active.length} thread{active.length === 1 ? '' : 's'} to address
            </h3>
          </div>
        </header>
        {active.map((thread) => (
          <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
        ))}
      </section>
      {resolved.length > 0 ? (
        <details className="resolved-threads">
          <summary>
            <Icon name="check" size={14} />
            {resolved.length} resolved or outdated thread{resolved.length === 1 ? '' : 's'}
          </summary>
          {resolved.map((thread) => (
            <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
          ))}
        </details>
      ) : null}
    </div>
  );
}

function ThreadCard({ thread, workflow }: { thread: ReviewThread; workflow: ReviewWorkflowModel }) {
  const key = `thread:${thread.id}`;
  const busy = workflow.actionStates[key] === 'running';
  const failedRun = workflow.runs.find(
    (run) =>
      run.threadId === thread.id && run.action === 'reply_resolve' && run.status === 'failed',
  );
  const location = thread.path
    ? `${thread.path}${thread.line ? `:${thread.line}` : ''}`
    : 'General review thread';
  return (
    <article
      className={
        thread.resolved || thread.outdated ? 'thread-card thread-card--muted' : 'thread-card'
      }
    >
      <header className="thread-card__header">
        <div>
          <span className="thread-card__state">
            <Icon name={thread.resolved ? 'check' : thread.outdated ? 'x' : 'clock'} size={13} />
            {thread.resolved ? 'Resolved' : thread.outdated ? 'Outdated' : 'Needs reply'}
          </span>
          {thread.hasNewActivity && !thread.resolved ? (
            <span className="thread-card__new">
              <Icon name="spark" size={12} /> New activity
            </span>
          ) : null}
        </div>
        <code title={location}>{location}</code>
      </header>
      <div className="thread-card__comments">
        {thread.comments.map((comment) => (
          <section className="review-comment" key={comment.id}>
            <header>
              <span className="review-comment__avatar" aria-hidden="true">
                {comment.authorLogin.slice(0, 1).toUpperCase()}
              </span>
              <strong>@{comment.authorLogin}</strong>
              <span className="review-comment__kind">
                <Icon name={comment.isBot ? 'spark' : 'github'} size={12} />
                {comment.isBot ? 'Automated review' : 'Human review'}
              </span>
              <time>{formatRelativeTime(comment.updatedAt)}</time>
            </header>
            {comment.diffHunk ? (
              <pre className="review-comment__diff">{comment.diffHunk}</pre>
            ) : null}
            <p>{comment.body}</p>
          </section>
        ))}
      </div>
      {!thread.resolved && !thread.outdated ? (
        <footer className="thread-card__actions">
          <div>
            <button
              className="button button--quiet"
              type="button"
              disabled={busy}
              onClick={() => void workflow.replyAndResolve(thread.id, failedRun?.id)}
            >
              <Icon name="check" size={14} />
              {busy ? 'Working…' : failedRun ? 'Retry reply and resolve' : 'Reply and resolve'}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() => void workflow.startFixSession(thread.id)}
            >
              <Icon name="spark" size={14} /> Fix and reply
            </button>
          </div>
          <button
            className="button button--quiet thread-card__terminal"
            type="button"
            disabled={busy}
            onClick={() => void workflow.openTerminal(thread.id)}
          >
            <Icon name="terminal" size={14} /> Open terminal
          </button>
        </footer>
      ) : null}
      {workflow.actionErrors[key] ? (
        <p className="thread-card__error" role="alert">
          <Icon name="alert" size={13} /> {workflow.actionErrors[key]}
        </p>
      ) : null}
    </article>
  );
}

function ChecksView({ checks }: { checks: CheckRun[] }) {
  const grouped = useMemo(() => {
    const order = ['danger', 'warning', 'success', 'neutral'] as const;
    return order
      .map((tone) => ({ tone, checks: checks.filter((check) => checkTone(check) === tone) }))
      .filter((group) => group.checks.length > 0);
  }, [checks]);
  if (checks.length === 0) {
    return (
      <div className="review-empty-state">
        <Icon name="check" size={20} />
        <strong>No check runs were reported</strong>
        <span>
          Mission Control will display required and optional checks after GitHub reports them.
        </span>
      </div>
    );
  }
  return (
    <div className="check-groups">
      {grouped.map((group) => (
        <section className="check-group" key={group.tone}>
          <h3>{checkGroupLabel(group.tone, group.checks.length)}</h3>
          {group.checks.map((check) => (
            <article className="check-row" key={check.id}>
              <span className={`check-row__mark check-row__mark--${group.tone}`}>
                <Icon
                  name={
                    group.tone === 'success' ? 'check' : group.tone === 'danger' ? 'x' : 'clock'
                  }
                  size={13}
                />
              </span>
              <div>
                <strong>{check.name}</strong>
                <span>{checkStatusLabel(check)}</span>
              </div>
              {check.required ? <StatusPill tone="neutral" label="Required" compact /> : null}
              <time>{formatRelativeTime(check.updatedAt)}</time>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function RunsView({ runs, workflow }: { runs: AgentRun[]; workflow: ReviewWorkflowModel }) {
  if (runs.length === 0) {
    return (
      <div className="review-empty-state">
        <Icon name="terminal" size={20} />
        <strong>No agent runs yet</strong>
        <span>
          Start from an open thread to keep the run, worktree, and GitHub checkpoints together.
        </span>
      </div>
    );
  }
  return (
    <div className="run-list">
      {runs.map((run) => (
        <article className="run-row" key={run.id}>
          <span className={`run-row__mark run-row__mark--${run.status}`}>
            <Icon
              name={
                run.status === 'completed' ? 'check' : run.status === 'running' ? 'sync' : 'alert'
              }
              size={14}
            />
          </span>
          <div>
            <strong>{runActionLabel(run.action)}</strong>
            <span>{run.summary ?? `${agentLabel(run.agent)} session`}</span>
            {run.worktreePath ? <code title={run.worktreePath}>{run.worktreePath}</code> : null}
          </div>
          <div className="run-row__meta">
            <span>{statusLabel(run.status)}</span>
            <time>{formatRelativeTime(run.startedAt)}</time>
          </div>
          {run.logPath ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => workflow.setActiveRun(run)}
            >
              View terminal
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ReviewClearState({ attentionCount }: { attentionCount: number }) {
  return (
    <div className="review-empty-state">
      <Icon name="check" size={20} />
      <strong>
        {attentionCount > 0 ? 'No cached review threads' : 'All review threads are clear'}
      </strong>
      <span>
        {attentionCount > 0
          ? 'Refresh GitHub to reconcile the detailed thread cache.'
          : 'Mission Control is monitoring this pull request for new comments and review activity.'}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail-skeleton" aria-label="Loading review details">
      <span className="skeleton skeleton--heading" />
      <span className="skeleton skeleton--title" />
      <span className="skeleton skeleton--title" />
    </div>
  );
}

function checkTone(check: CheckRun): 'danger' | 'warning' | 'success' | 'neutral' {
  const conclusion = check.conclusion?.toUpperCase();
  if (
    ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(
      conclusion ?? '',
    )
  )
    return 'danger';
  if (
    check.status.toUpperCase() !== 'COMPLETED' ||
    ['CANCELLED', 'STALE'].includes(conclusion ?? '')
  )
    return 'warning';
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED')
    return 'success';
  return 'neutral';
}

function checkStatusLabel(check: CheckRun) {
  return (check.conclusion ?? check.status).toLocaleLowerCase().replaceAll('_', ' ');
}

function checkGroupLabel(tone: ReturnType<typeof checkTone>, count: number) {
  const label =
    tone === 'danger'
      ? 'Failing'
      : tone === 'warning'
        ? 'In progress or cancelled'
        : tone === 'success'
          ? 'Successful'
          : 'Other';
  return `${label} · ${count}`;
}

function runActionLabel(action: AgentRun['action']) {
  if (action === 'fix_reply_resolve') return 'Fix and reply';
  if (action === 'reply_resolve') return 'Reply and resolve';
  return 'Worktree terminal';
}

function agentLabel(agent: AgentRun['agent']) {
  if (agent === 'claude_code') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return 'Shell';
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
