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
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

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
    <article className="min-h-full bg-transparent">
      <header className="flex items-start justify-between gap-4 border-b border-hairline bg-surface px-6 pt-5 pb-[18px] max-[1120px]:flex-col max-[980px]:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[0.78rem] text-ink-secondary">
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
          <h2 className="my-[9px] mt-2.5 max-w-[38ch] text-[1.35rem] leading-[1.2] font-[670] tracking-[-0.025em] text-balance">
            {pullRequest.title}
          </h2>
          <div className="flex flex-wrap gap-3 text-[0.74rem] text-ink-secondary">
            <span className="inline-flex items-center gap-[5px]">
              <Icon name="branch" size={14} />
              {pullRequest.headRef} → {pullRequest.baseRef}
            </span>
            <span>Authored by @{pullRequest.authorLogin}</span>
            <span>Updated {formatRelativeTime(pullRequest.updatedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 max-[980px]:flex-col max-[980px]:items-stretch">
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
        <div
          className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-6 py-2.5 text-[0.78rem] text-danger-deep max-[980px]:px-5"
          role="alert"
        >
          <Icon name="alert" size={15} />
          <span>{workflow.detailError}</span>
          <button
            className="ml-auto cursor-pointer border-0 bg-transparent font-bold text-inherit"
            type="button"
            onClick={() => void workflow.reload()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {workflow.actionErrors[copilotKey] ? (
        <div
          className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-6 py-2.5 text-[0.78rem] text-danger-deep max-[980px]:px-5"
          role="alert"
        >
          <Icon name="alert" size={15} />
          <span>{workflow.actionErrors[copilotKey]}</span>
        </div>
      ) : null}

      <nav
        className="flex items-center gap-1 border-b border-hairline px-6 max-[980px]:px-5"
        aria-label="Pull request detail sections"
      >
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
        <label className="ml-auto flex items-center gap-2 pl-3 text-xs font-semibold text-ink-secondary max-[980px]:justify-between">
          <span className="max-[1120px]:hidden">Local agent</span>
          <Select
            value={workflow.selectedAgent}
            onValueChange={(value) => workflow.setSelectedAgent(value as AgentKind)}
          >
            <SelectTrigger
              className="min-w-[164px] border-hairline-strong bg-surface-raised"
              aria-label="Local agent"
            >
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

      <div
        className="min-h-[260px] px-6 pt-5 pb-8 max-[980px]:px-5"
        aria-busy={workflow.detailLoading}
      >
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
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 font-semibold text-ink-secondary after:absolute after:right-3 after:bottom-[-1px] after:left-3 after:h-0.5 after:bg-transparent after:content-[''] hover:text-ink",
        active && 'text-ink after:bg-ink',
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      <span
        className={cn(
          'min-w-[21px] rounded-full bg-surface-muted px-1.5 py-0.5 text-center text-[0.65rem] text-ink-secondary',
          alertCount > 0 && 'bg-danger-soft text-danger-deep',
        )}
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
    <div className="flex flex-col gap-6">
      {active.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Open review threads">
          {active.map((thread) => (
            <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
          ))}
        </section>
      ) : null}
      {resolved.length > 0 ? (
        <details className="text-ink-secondary [&[open]>summary]:mb-3 [&>article+article]:mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.78rem] font-semibold">
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
      className={cn(
        'overflow-hidden rounded-xl border border-hairline bg-surface-raised transition-[border-color,box-shadow] duration-state ease-out hover:border-hairline-strong',
        (thread.resolved || thread.outdated) && 'bg-surface opacity-[0.78]',
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline bg-[color-mix(in_oklch,var(--surface-muted)_52%,var(--surface))] px-4 py-[9px]">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-[5px] text-[0.72rem] font-semibold text-warning-deep',
              (thread.resolved || thread.outdated) && 'text-success-deep',
            )}
          >
            <Icon name={thread.resolved ? 'check' : thread.outdated ? 'x' : 'clock'} size={13} />
            {thread.resolved ? 'Resolved' : thread.outdated ? 'Outdated' : 'Needs reply'}
          </span>
          {thread.hasNewActivity && !thread.resolved ? (
            <span className="inline-flex items-center gap-[5px] text-[0.72rem] font-semibold text-info-deep">
              <Icon name="spark" size={12} /> New activity
            </span>
          ) : null}
        </div>
        <code
          className="overflow-hidden font-mono text-[0.7rem] text-ellipsis whitespace-nowrap text-ink-secondary"
          title={location}
        >
          {location}
        </code>
      </header>
      <div className="flex flex-col">
        {thread.comments.map((comment) => (
          <section
            className="border-t border-hairline px-4 py-3.5 first:border-t-0"
            key={comment.id}
          >
            <header className="mb-3 flex items-center gap-2">
              <span
                className="grid size-[22px] place-items-center rounded-full bg-surface-muted text-[0.65rem] font-bold text-ink-secondary"
                aria-hidden="true"
              >
                {comment.authorLogin.slice(0, 1).toUpperCase()}
              </span>
              <strong>@{comment.authorLogin}</strong>
              <span className="inline-flex items-center gap-[5px] border-l border-hairline pl-2 text-[0.72rem] font-semibold text-ink-secondary">
                <Icon name={comment.isBot ? 'spark' : 'github'} size={12} />
                {comment.isBot ? 'Automated review' : 'Human review'}
              </span>
              <time className="ml-auto text-[0.7rem] text-ink-muted">
                {formatRelativeTime(comment.updatedAt)}
              </time>
            </header>
            {comment.diffHunk ? (
              <pre className="mb-3 overflow-hidden border-l-2 border-hairline-strong bg-surface-muted px-3 py-2 font-mono text-[0.68rem] text-ellipsis whitespace-nowrap text-ink-secondary">
                {comment.diffHunk}
              </pre>
            ) : null}
            <p className="m-0 text-[0.83rem] leading-[1.55] whitespace-pre-wrap text-ink-secondary">
              {comment.body}
            </p>
          </section>
        ))}
      </div>
      {!thread.resolved && !thread.outdated ? (
        <footer className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2.5 max-[980px]:flex-col max-[980px]:items-stretch">
          <div className="flex items-center gap-2">
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
            className="ml-auto"
            variant="outline"
            disabled={busy}
            onClick={() => void workflow.openTerminal(thread.id)}
          >
            <Icon name="terminal" size={14} /> Open terminal
          </Button>
        </footer>
      ) : null}
      {workflow.actionErrors[key] ? (
        <p
          className="m-0 flex items-start gap-1.5 px-4 pb-3 text-[0.73rem] text-danger-deep"
          role="alert"
        >
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
      <div className="flex min-h-[230px] flex-col items-center justify-center gap-2 text-center text-ink-muted [&>svg]:text-success-deep">
        <Icon name="check" size={20} />
        <strong className="text-[0.92rem] text-ink">No check runs were reported</strong>
        <span className="max-w-[460px] text-[0.78rem]">
          Mission Control will display required and optional checks after GitHub reports them.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-3 border-b border-hairline pb-4"
        aria-label={`${checks.length} check runs`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <CheckSummaryItem tone="danger" count={totals.danger} label="Failing" />
          <CheckSummaryItem tone="warning" count={totals.warning} label="Pending" />
          <CheckSummaryItem tone="success" count={totals.success} label="Successful" />
          {totals.neutral > 0 ? (
            <CheckSummaryItem tone="neutral" count={totals.neutral} label="Other" />
          ) : null}
        </div>
        <div
          className="flex h-[7px] w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted"
          aria-hidden="true"
        >
          {(['danger', 'warning', 'success', 'neutral'] as const).map((tone) =>
            totals[tone] > 0 ? (
              <span
                className={checkSummarySegmentVariants({ tone })}
                style={{ flexGrow: totals[tone] }}
                key={tone}
              />
            ) : null,
          )}
        </div>
      </div>
      {grouped.map((group) => (
        <section className="flex flex-col gap-3" key={group.tone}>
          <h3 className="m-0 text-[0.88rem] text-ink">
            {checkGroupLabel(group.tone, group.checks.length)}
          </h3>
          {group.checks.map((check) => (
            <article
              className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-hairline py-3"
              key={check.id}
            >
              <span className={checkMarkVariants({ tone: group.tone })}>
                <Icon
                  name={
                    group.tone === 'success' ? 'check' : group.tone === 'danger' ? 'x' : 'clock'
                  }
                  size={13}
                />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong>{check.name}</strong>
                <span className="text-[0.72rem] text-ink-muted">{checkStatusLabel(check)}</span>
              </div>
              {check.required ? <StatusPill tone="neutral" label="Required" compact /> : null}
              <time className="text-[0.72rem] whitespace-nowrap text-ink-muted">
                {formatRelativeTime(check.updatedAt)}
              </time>
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
    <span className={checkSummaryItemVariants({ tone })}>
      <Icon name={tone === 'success' ? 'check' : tone === 'danger' ? 'x' : 'clock'} size={13} />
      <strong>{count}</strong> {label}
    </span>
  );
}

function RunsView({ runs, workflow }: { runs: AgentRun[]; workflow: ReviewWorkflowModel }) {
  if (runs.length === 0) {
    return (
      <div className="flex min-h-[230px] flex-col items-center justify-center gap-2 text-center text-ink-muted [&>svg]:text-success-deep">
        <Icon name="terminal" size={20} />
        <strong className="text-[0.92rem] text-ink">No agent runs yet</strong>
        <span className="max-w-[460px] text-[0.78rem]">
          Start from an open thread to keep the run, worktree, and GitHub checkpoints together.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {runs.map((run) => (
        <article
          className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-hairline py-3 max-[980px]:grid-cols-[28px_minmax(0,1fr)_auto] max-[980px]:[&>[data-slot=button]]:col-[2/-1] max-[980px]:[&>[data-slot=button]]:justify-self-start"
          key={run.id}
        >
          <span className={runMarkVariants({ status: run.status })}>
            <Icon
              name={
                run.status === 'completed' ? 'check' : run.status === 'running' ? 'sync' : 'alert'
              }
              size={14}
            />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <strong>{runActionLabel(run.action)}</strong>
            <span className="text-[0.72rem] text-ink-muted">
              {run.summary ?? `${agentLabel(run.agent)} session`}
            </span>
            {run.worktreePath ? (
              <code
                className="max-w-[520px] overflow-hidden font-mono text-[0.65rem] text-ellipsis whitespace-nowrap text-ink-muted"
                title={run.worktreePath}
              >
                {run.worktreePath}
              </code>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[0.72rem] text-ink-muted">{statusLabel(run.status)}</span>
            <time className="text-[0.72rem] text-ink-muted">
              {formatRelativeTime(run.startedAt)}
            </time>
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
    <div className="flex min-h-[230px] flex-col items-center justify-center gap-2 text-center text-ink-muted [&>svg]:text-success-deep">
      <Icon name="check" size={20} />
      <strong className="text-[0.92rem] text-ink">
        {attentionCount > 0 ? 'No cached review threads' : 'All review threads are clear'}
      </strong>
      <span className="max-w-[460px] text-[0.78rem]">
        {attentionCount > 0
          ? 'Refresh GitHub to reconcile the detailed thread cache.'
          : 'Mission Control is monitoring this pull request for new comments and review activity.'}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-3" aria-label="Loading review details">
      <span className="relative h-[30px] w-[45%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
      <span className="relative h-[9px] w-[78%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
      <span className="relative h-[9px] w-[78%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
    </div>
  );
}

const checkSummaryItemVariants = cva(
  'inline-flex items-center gap-[5px] text-xs text-ink-secondary [&>strong]:text-inherit [&>strong]:[font-variant-numeric:tabular-nums]',
  {
    variants: {
      tone: {
        danger: 'text-danger-deep',
        warning: 'text-warning-deep',
        success: 'text-success-deep',
        neutral: '',
      },
    },
  },
);

const checkSummarySegmentVariants = cva('min-w-1', {
  variants: {
    tone: {
      danger: 'bg-danger',
      warning: 'bg-warning',
      success: 'bg-success',
      neutral: 'bg-ink-muted',
    },
  },
});

const checkMarkVariants = cva(
  'grid size-[22px] place-items-center rounded-full border border-hairline bg-surface-muted',
  {
    variants: {
      tone: {
        danger: 'border-danger/35 bg-danger-soft text-danger-deep',
        warning: 'border-warning/40 bg-warning-soft text-warning-deep',
        success: 'border-success/35 bg-success-soft text-success-deep',
        neutral: '',
      },
    },
  },
);

const runMarkVariants = cva(
  'grid size-[22px] place-items-center rounded-full border border-hairline bg-surface-muted',
  {
    variants: {
      status: {
        running: 'border-warning/40 bg-warning-soft text-warning-deep',
        completed: 'border-success/35 bg-success-soft text-success-deep',
        failed: 'border-danger/35 bg-danger-soft text-danger-deep',
        interrupted: 'border-danger/35 bg-danger-soft text-danger-deep',
        stalled: 'border-danger/35 bg-danger-soft text-danger-deep',
      },
    },
  },
);

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
