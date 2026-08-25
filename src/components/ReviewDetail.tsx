import { useMemo, useState } from 'react';
import type { AgentKind, AgentRun, CheckRun, ReviewThread } from '../contracts';
import type { ReviewWorkflowModel } from '../hooks/useReviewWorkflow';
import type { MissionControlClient } from '../lib/client';
import { formatRelativeTime, type PullRequestInboxEntry } from '../lib/inbox';
import {
  buildOverviewSignals,
  checkTone,
  type OverviewSignal,
  type ReviewDetailTab,
} from '../lib/reviewOverview';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from './Icon';
import { ReasonPill, StatusPill } from './StatusMark';
import { TerminalPanel } from './TerminalPanel';
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

interface ReviewDetailProps {
  client: MissionControlClient;
  entry: PullRequestInboxEntry;
  workflow: ReviewWorkflowModel;
  onOpenUrl(url: string): void;
}

export function ReviewDetail({ client, entry, workflow, onOpenUrl }: ReviewDetailProps) {
  const { pullRequest, attention } = entry;
  const [tab, setTab] = useState<ReviewDetailTab>('overview');
  const detail = workflow.detail?.pullRequestId === pullRequest.id ? workflow.detail : null;
  const openThreads =
    detail?.threads.filter((thread) => !thread.resolved && !thread.outdated) ?? [];
  const failedChecks = detail?.checks.filter((check) => checkTone(check) === 'danger').length ?? 0;
  const overviewSignals = buildOverviewSignals(entry, detail?.checks ?? [], openThreads.length);

  return (
    <article className="min-h-full bg-transparent">
      <header className="flex items-start justify-between gap-5 border-b border-hairline bg-surface px-5 py-3.5 max-[980px]:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
            {entry.primaryReason ? (
              <ReasonPill reason={entry.primaryReason} />
            ) : (
              <StatusPill tone="success" label="No active escalation" />
            )}
            {pullRequest.draft ? <StatusPill tone="neutral" label="Draft" /> : null}
            <span className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-surface-muted px-2.5 font-mono text-ink-secondary">
              <Icon name="branch" size={13} />
              {pullRequest.headRef} → {pullRequest.baseRef}
            </span>
            <span className="inline-flex h-[26px] items-center rounded-md bg-surface-muted px-2.5 font-mono text-ink-secondary">
              {pullRequest.repository} #{pullRequest.number}
            </span>
          </div>
          <h2 className="mt-2 mb-1.5 max-w-[48ch] text-[1.35rem] leading-[1.2] font-[670] tracking-[-0.025em] text-balance">
            {pullRequest.title}
          </h2>
          <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
            <span>Authored by @{pullRequest.authorLogin}</span>
            <span>Updated {formatRelativeTime(pullRequest.updatedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            className="h-8 px-2.5 text-ink-secondary hover:bg-surface-muted hover:text-ink"
            variant="ghost"
            size="sm"
            onClick={() => onOpenUrl(pullRequest.url)}
          >
            Open on GitHub
            <Icon name="arrow-up-right" size={15} />
          </Button>
        </div>
      </header>

      {workflow.detailError ? (
        <div
          className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-5 py-2.5 text-xs text-danger-deep max-[980px]:px-4"
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
      <Tabs
        className="gap-0"
        value={tab}
        onValueChange={(value) => setTab(value as ReviewDetailTab)}
      >
        <TabsList
          className="h-11 w-full justify-start gap-1 rounded-none border-b border-hairline bg-surface px-5 py-0 max-[980px]:px-4"
          variant="line"
          aria-label="Pull request detail sections"
        >
          <DetailTabTrigger value="threads" label="Review threads" count={openThreads.length} />
          <DetailTabTrigger
            value="checks"
            label="Checks"
            count={detail?.checks.length ?? 0}
            alertCount={failedChecks}
          />
          <DetailTabTrigger value="runs" label="Agent runs" count={workflow.runs.length} />
          <DetailTabTrigger value="overview" label="Overview" />
        </TabsList>

        <TabsContent value="overview" className="m-0">
          <OverviewView
            entry={entry}
            signals={overviewSignals}
            detailLoading={workflow.detailLoading && !detail}
            onChangeTab={setTab}
          />
        </TabsContent>
        <TabsContent value="threads" className="m-0 px-5 py-5 max-[980px]:px-4">
          {workflow.detailLoading && !detail ? <DetailSkeleton /> : null}
          {!workflow.detailLoading ? (
            <ThreadsView
              threads={detail?.threads ?? []}
              attentionCount={attention.length}
              workflow={workflow}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="checks" className="m-0 px-5 py-5 max-[980px]:px-4">
          {workflow.detailLoading && !detail ? <DetailSkeleton /> : null}
          {!workflow.detailLoading ? (
            <ChecksView checks={detail?.checks ?? []} onOpenUrl={onOpenUrl} />
          ) : null}
        </TabsContent>
        <TabsContent value="runs" className="m-0 px-5 py-5 max-[980px]:px-4">
          <RunsView runs={workflow.runs} workflow={workflow} />
        </TabsContent>
      </Tabs>

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

function DetailTabTrigger({
  value,
  label,
  count,
  alertCount = 0,
}: {
  value: ReviewDetailTab;
  label: string;
  count?: number;
  alertCount?: number;
}) {
  return (
    <TabsTrigger className="h-full flex-none px-2.5 text-xs font-semibold" value={value}>
      <span>{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'min-w-5 rounded-full bg-surface-muted px-1.5 py-0.5 text-center text-xs text-ink-secondary',
            alertCount > 0 && 'bg-danger-soft text-danger-deep',
          )}
        >
          {alertCount > 0 ? `${alertCount} failing` : count}
        </span>
      ) : null}
    </TabsTrigger>
  );
}

function LocalAgentSelect({ workflow }: { workflow: ReviewWorkflowModel }) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-ink-secondary">
      <span>Local agent</span>
      <Select
        value={workflow.selectedAgent}
        onValueChange={(value) => workflow.setSelectedAgent(value as AgentKind)}
      >
        <SelectTrigger
          className="min-w-40 border-hairline-strong bg-surface-raised"
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
  );
}

function OverviewView({
  entry,
  signals,
  detailLoading,
  onChangeTab,
}: {
  entry: PullRequestInboxEntry;
  signals: OverviewSignal[];
  detailLoading: boolean;
  onChangeTab(tab: ReviewDetailTab): void;
}) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const { pullRequest } = entry;
  const canExpandDescription = pullRequest.bodyText.length > 360;

  return (
    <div className="px-5 pb-8 max-[980px]:px-4">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] gap-8 border-b border-hairline py-5 max-[980px]:grid-cols-1">
        <div className="min-w-0 max-w-[72ch]">
          <span className="text-xs font-semibold tracking-[0.04em] text-ink-muted uppercase">
            Change context
          </span>
          <h3 className="mt-1.5 mb-2 text-base font-semibold">Pull request description</h3>
          {pullRequest.bodyText ? (
            <>
              <p
                className={cn(
                  'm-0 text-sm leading-6 whitespace-pre-wrap text-ink-secondary',
                  canExpandDescription && !descriptionExpanded && 'max-h-[4.5rem] overflow-hidden',
                )}
              >
                {pullRequest.bodyText}
              </p>
              {canExpandDescription ? (
                <button
                  className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-ink-secondary hover:text-ink"
                  type="button"
                  aria-expanded={descriptionExpanded}
                  onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                >
                  {descriptionExpanded ? 'Show less' : 'Show full description'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm leading-6 text-ink-muted">
              No pull request description was provided.
            </p>
          )}
        </div>
        <dl className="grid min-w-[220px] grid-cols-3 content-start gap-4 text-right max-[980px]:min-w-0 max-[980px]:text-left">
          <ChangeMetric label="Files" value={pullRequest.changedFiles} />
          <ChangeMetric label="Added" value={`+${pullRequest.additions}`} tone="success" />
          <ChangeMetric label="Removed" value={`−${pullRequest.deletions}`} tone="danger" />
        </dl>
      </section>

      <section className="py-5" aria-labelledby="readiness-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold tracking-[0.04em] text-ink-muted uppercase">
              Decision signals
            </span>
            <h3 className="mt-1.5 mb-0 text-base font-semibold" id="readiness-title">
              Merge readiness
            </h3>
          </div>
          <span className="text-xs text-ink-muted">GitHub facts</span>
        </div>
        {detailLoading ? (
          <div className="grid grid-cols-4 border-t border-hairline max-[1120px]:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <span
                className="h-[74px] animate-pulse border-r border-b border-hairline bg-surface-muted/60 last:border-r-0 max-[1120px]:[&:nth-child(2n)]:border-r-0"
                key={item}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 border-t border-hairline max-[1120px]:grid-cols-2">
            {signals.map((signal) => {
              const target = signal.target;
              return (
                <OverviewSignalItem
                  signal={signal}
                  onSelect={target ? () => onChangeTab(target) : undefined}
                  key={signal.id}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewSignalItem({
  signal,
  onSelect,
}: {
  signal: OverviewSignal;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <span className={overviewSignalMarkVariants({ tone: signal.tone })} aria-hidden="true">
        <Icon
          name={
            signal.tone === 'success'
              ? 'check'
              : signal.tone === 'danger'
                ? 'alert'
                : signal.tone === 'warning'
                  ? 'clock'
                  : 'info'
          }
          size={14}
        />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-xs text-ink-muted">{signal.label}</span>
        <strong className="overflow-hidden text-sm text-ellipsis whitespace-nowrap">
          {signal.value}
        </strong>
      </span>
      {onSelect ? <Icon className="ml-auto text-ink-muted" name="arrow-right" size={14} /> : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        className="flex min-h-[74px] items-center gap-2.5 border-0 border-r border-b border-hairline bg-transparent px-3 text-left transition-colors hover:bg-surface-muted last:border-r-0 max-[1120px]:[&:nth-child(2n)]:border-r-0"
        type="button"
        aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className="flex min-h-[74px] items-center gap-2.5 border-r border-b border-hairline px-3 last:border-r-0 max-[1120px]:[&:nth-child(2n)]:border-r-0"
      title={signal.detail}
    >
      {content}
    </div>
  );
}

function ChangeMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'm-0 text-sm font-semibold [font-variant-numeric:tabular-nums]',
          tone === 'success' && 'text-success-deep',
          tone === 'danger' && 'text-danger-deep',
        )}
      >
        {value}
      </dd>
    </div>
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
    <div className="flex flex-col gap-4">
      {active.length > 0 ? (
        <div className="flex justify-end">
          <LocalAgentSelect workflow={workflow} />
        </div>
      ) : null}
      {active.length > 0 ? (
        <section
          className="border-y border-hairline [&>article+article]:border-t [&>article+article]:border-hairline"
          aria-label="Open review threads"
        >
          {active.map((thread) => (
            <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
          ))}
        </section>
      ) : null}
      {resolved.length > 0 ? (
        <details className="text-ink-secondary [&[open]>summary]:mb-3 [&[open]>div]:border-y [&[open]>div]:border-hairline [&[open]>div>article+article]:border-t [&[open]>div>article+article]:border-hairline">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold">
            <Icon name="check" size={14} />
            {resolved.length} resolved or outdated thread{resolved.length === 1 ? '' : 's'}
          </summary>
          <div>
            {resolved.map((thread) => (
              <ThreadCard thread={thread} workflow={workflow} key={thread.id} />
            ))}
          </div>
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
        'overflow-hidden bg-transparent',
        (thread.resolved || thread.outdated) && 'opacity-[0.78]',
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-1 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold text-warning-deep',
              (thread.resolved || thread.outdated) && 'text-success-deep',
            )}
          >
            <Icon name={thread.resolved ? 'check' : thread.outdated ? 'x' : 'clock'} size={13} />
            {thread.resolved ? 'Resolved' : thread.outdated ? 'Outdated' : 'Needs reply'}
          </span>
          {thread.hasNewActivity && !thread.resolved ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-info-deep">
              <Icon name="spark" size={12} /> New activity
            </span>
          ) : null}
        </div>
        <code
          className="overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-ink-secondary"
          title={location}
        >
          {location}
        </code>
      </header>
      <div className="flex flex-col">
        {thread.comments.map((comment) => (
          <section
            className="border-t border-hairline px-1 py-3.5 first:border-t-0"
            key={comment.id}
          >
            <header className="mb-3 flex items-center gap-2">
              <span
                className="grid size-6 place-items-center rounded-full bg-surface-muted text-xs font-bold text-ink-secondary"
                aria-hidden="true"
              >
                {comment.authorLogin.slice(0, 1).toUpperCase()}
              </span>
              <strong>@{comment.authorLogin}</strong>
              <span className="inline-flex items-center gap-1.5 border-l border-hairline pl-2 text-xs font-semibold text-ink-secondary">
                <Icon name={comment.isBot ? 'spark' : 'github'} size={12} />
                {comment.isBot ? 'Automated review' : 'Human review'}
              </span>
              <time className="ml-auto text-xs text-ink-muted">
                {formatRelativeTime(comment.updatedAt)}
              </time>
            </header>
            {comment.diffHunk ? (
              <pre className="mb-3 overflow-hidden rounded-md border border-hairline bg-surface-muted px-3 py-2 font-mono text-xs text-ellipsis whitespace-nowrap text-ink-secondary">
                {comment.diffHunk}
              </pre>
            ) : null}
            <p className="m-0 text-sm leading-6 whitespace-pre-wrap text-ink-secondary">
              {comment.body}
            </p>
          </section>
        ))}
      </div>
      {!thread.resolved && !thread.outdated ? (
        <footer className="flex items-center justify-between gap-2 border-t border-hairline px-1 py-2.5 max-[980px]:flex-col max-[980px]:items-stretch">
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
        <p className="m-0 flex items-start gap-1.5 px-1 pb-3 text-xs text-danger-deep" role="alert">
          <Icon name="alert" size={13} /> {workflow.actionErrors[key]}
        </p>
      ) : null}
    </article>
  );
}

function ChecksView({ checks, onOpenUrl }: { checks: CheckRun[]; onOpenUrl(url: string): void }) {
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
        <strong className="text-sm text-ink">No check runs were reported</strong>
        <span className="max-w-[460px] text-xs">
          Captain will display required and optional checks after GitHub reports them.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
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
          className="flex h-1 w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted"
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
      <div className="border-y border-hairline">
        {grouped.map((group) => (
          <section className="border-t border-hairline first:border-t-0" key={group.tone}>
            <h3 className="m-0 border-b border-hairline px-1 py-2.5 text-sm font-semibold text-ink">
              {checkGroupLabel(group.tone, group.checks.length)}
            </h3>
            {group.checks.map((check) => (
              <CheckRow check={check} tone={group.tone} onOpenUrl={onOpenUrl} key={check.id} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function CheckRow({
  check,
  tone,
  onOpenUrl,
}: {
  check: CheckRun;
  tone: ReturnType<typeof checkTone>;
  onOpenUrl(url: string): void;
}) {
  const detailsUrl = check.detailsUrl;
  const rowClassName = cn(
    'grid w-full grid-cols-[24px_minmax(0,1fr)_auto_auto_16px] items-center gap-3 border-0 border-t border-hairline bg-transparent px-1 py-3 text-left first:border-t-0',
    detailsUrl &&
      'transition-colors hover:bg-surface-muted focus-visible:relative focus-visible:z-[1]',
  );
  const content = (
    <>
      <span className={checkMarkVariants({ tone })}>
        <Icon name={tone === 'success' ? 'check' : tone === 'danger' ? 'x' : 'clock'} size={13} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <strong className="overflow-hidden text-sm text-ellipsis whitespace-nowrap">
          {check.name}
        </strong>
        <span className="text-xs text-ink-muted">{checkStatusLabel(check)}</span>
      </span>
      {check.required ? <StatusPill tone="neutral" label="Required" compact /> : <span />}
      <time className="text-xs whitespace-nowrap text-ink-muted">
        {formatRelativeTime(check.updatedAt)}
      </time>
      {detailsUrl ? <Icon className="text-ink-muted" name="arrow-up-right" size={14} /> : <span />}
    </>
  );
  const row = detailsUrl ? (
    <button
      className={rowClassName}
      type="button"
      aria-label={`${check.name}: ${checkStatusLabel(check)}. Open check details`}
      onClick={() => onOpenUrl(detailsUrl)}
    >
      {content}
    </button>
  ) : (
    <div
      className={cn(rowClassName, check.required && 'cursor-pointer')}
      tabIndex={check.required ? 0 : undefined}
      aria-label={
        check.required
          ? `${check.name}: ${checkStatusLabel(check)}. GitHub reports this check as required`
          : undefined
      }
    >
      {content}
    </div>
  );

  if (!check.required) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent>
        GitHub reports this check as required by the pull request rules.
      </TooltipContent>
    </Tooltip>
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
        <strong className="text-sm text-ink">No agent runs yet</strong>
        <span className="max-w-[460px] text-xs">
          Start from an open thread to keep the run, worktree, and GitHub checkpoints together.
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col border-t border-hairline">
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
            <span className="text-xs text-ink-muted">
              {run.summary ?? `${agentLabel(run.agent)} session`}
            </span>
            {run.worktreePath ? (
              <code
                className="max-w-[520px] overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-ink-muted"
                title={run.worktreePath}
              >
                {run.worktreePath}
              </code>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-ink-muted">{statusLabel(run.status)}</span>
            <time className="text-xs text-ink-muted">{formatRelativeTime(run.startedAt)}</time>
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
      <strong className="text-sm text-ink">
        {attentionCount > 0 ? 'No cached review threads' : 'All review threads are clear'}
      </strong>
      <span className="max-w-[460px] text-xs">
        {attentionCount > 0
          ? 'Refresh GitHub to reconcile the detailed thread cache.'
          : 'Captain is monitoring this pull request for new comments and review activity.'}
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

const overviewSignalMarkVariants = cva(
  'grid size-7 shrink-0 place-items-center rounded-full border border-hairline bg-surface-muted',
  {
    variants: {
      tone: {
        danger: 'border-danger/35 bg-danger-soft text-danger-deep',
        warning: 'border-warning/40 bg-warning-soft text-warning-deep',
        success: 'border-success/35 bg-success-soft text-success-deep',
        info: 'border-info/35 bg-info-soft text-info-deep',
        neutral: 'text-ink-muted',
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
