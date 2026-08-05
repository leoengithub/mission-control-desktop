import { useMemo, useState } from 'react';
import type { AgentKind, AgentRun, CheckRun, ReviewThread } from '../contracts';
import type { ReviewWorkflowModel } from '../hooks/useReviewWorkflow';
import type { MissionControlClient } from '../lib/client';
import { formatRelativeTime, type PullRequestInboxEntry } from '../lib/inbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Icon } from './Icon';
import { ReasonPill, StatusPill } from './StatusMark';
import { TerminalPanel } from './TerminalPanel';

type DetailTab = 'threads' | 'checks' | 'runs';

interface ReviewDetailProps {
  client: MissionControlClient;
  entry: PullRequestInboxEntry;
  workflow: ReviewWorkflowModel;
  onOpen(): void;
}

export function ReviewDetail({ client, entry, workflow, onOpen }: ReviewDetailProps) {
  const { pullRequest, attention } = entry;
  const preferredTab: DetailTab =
    entry.primaryReason === 'required_checks_failing' ? 'checks' : 'threads';
  const [tab, setTab] = useState<DetailTab>(preferredTab);
  const detail = workflow.detail?.pullRequestId === pullRequest.id ? workflow.detail : null;
  const openThreads =
    detail?.threads.filter((thread) => !thread.resolved && !thread.outdated) ?? [];
  const failedChecks = detail?.checks.filter((check) => checkTone(check) === 'danger').length ?? 0;
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
          <Button
            variant="outline"
            size="lg"
            disabled={workflow.actionStates[copilotKey] === 'running'}
            onClick={() => void workflow.requestCopilotReview()}
          >
            <Icon name="spark" size={15} />
            {workflow.actionStates[copilotKey] === 'running'
              ? 'Requesting…'
              : 'Request Copilot review'}
          </Button>
          <Button size="lg" onClick={onOpen}>
            Open on GitHub
            <Icon name="arrow-up-right" size={15} />
          </Button>
        </div>
      </header>

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
        <label className="agent-select">
          <span>Local agent</span>
          <Select
            value={workflow.selectedAgent}
            onValueChange={(value) => workflow.setSelectedAgent(value as AgentKind)}
          >
            <SelectTrigger className="agent-select__trigger" aria-label="Local agent">
              <SelectValue placeholder="No local agent available">
                {workflow.agents.find((agent) => agent.agent === workflow.selectedAgent)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {workflow.agents.map((agent) => (
                <SelectItem disabled={!agent.available} value={agent.agent} key={agent.agent}>
                  {agent.label} {agent.available ? '' : '(not installed)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
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
      {active.length > 0 ? (
        <section className="thread-group" aria-label="Open review threads">
          {active.map((thread) => (
            <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
          ))}
        </section>
      ) : null}
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
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void workflow.replyAndResolve(thread.id, failedRun?.id)}
            >
              <Icon name="check" size={14} />
              {busy ? 'Working…' : failedRun ? 'Retry reply and resolve' : 'Reply and resolve'}
            </Button>
            <Button disabled={busy} onClick={() => void workflow.startFixSession(thread.id)}>
              <Icon name="spark" size={14} /> Fix and reply
            </Button>
          </div>
          <Button
            className="thread-card__terminal"
            variant="outline"
            disabled={busy}
            onClick={() => void workflow.openTerminal(thread.id)}
          >
            <Icon name="terminal" size={14} /> Open terminal
          </Button>
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
  const totals = useMemo(
    () => ({
      danger: checks.filter((check) => checkTone(check) === 'danger').length,
      warning: checks.filter((check) => checkTone(check) === 'warning').length,
      success: checks.filter((check) => checkTone(check) === 'success').length,
      neutral: checks.filter((check) => checkTone(check) === 'neutral').length,
    }),
    [checks],
  );
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
      <div className="check-summary" aria-label={`${checks.length} check runs`}>
        <div className="check-summary__legend">
          <CheckSummaryItem tone="danger" count={totals.danger} label="Failing" />
          <CheckSummaryItem tone="warning" count={totals.warning} label="Pending" />
          <CheckSummaryItem tone="success" count={totals.success} label="Successful" />
          {totals.neutral > 0 ? (
            <CheckSummaryItem tone="neutral" count={totals.neutral} label="Other" />
          ) : null}
        </div>
        <div className="check-summary__bar" aria-hidden="true">
          {(['danger', 'warning', 'success', 'neutral'] as const).map((tone) =>
            totals[tone] > 0 ? (
              <span
                className={`check-summary__segment check-summary__segment--${tone}`}
                style={{ flexGrow: totals[tone] }}
                key={tone}
              />
            ) : null,
          )}
        </div>
      </div>
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

function CheckSummaryItem({
  tone,
  count,
  label,
}: {
  tone: ReturnType<typeof checkTone>;
  count: number;
  label: string;
}) {
  return (
    <span className={`check-summary__item check-summary__item--${tone}`}>
      <Icon name={tone === 'success' ? 'check' : tone === 'danger' ? 'x' : 'clock'} size={13} />
      <strong>{count}</strong> {label}
    </span>
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
            <Button variant="outline" onClick={() => workflow.setActiveRun(run)}>
              View terminal
            </Button>
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
