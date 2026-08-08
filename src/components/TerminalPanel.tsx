import { useEffect, useRef, useState } from 'react';
import type { AgentRun, AgentRunStatus } from '../contracts';
import type { MissionControlClient } from '../lib/client';
import { formatRelativeTime } from '../lib/inbox';
import { Icon } from './Icon';
import { Button } from '@/components/ui/button';
import { cva } from 'class-variance-authority';

interface TerminalPanelProps {
  client: MissionControlClient;
  run: AgentRun;
  actionBusy: boolean;
  actionError: string | null;
  onClose(): void;
  onComplete(runId: string): void;
}

export function TerminalPanel({
  client,
  run,
  actionBusy,
  actionError,
  onClose,
  onComplete,
}: TerminalPanelProps) {
  const viewportRef = useRef<HTMLPreElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<AgentRunStatus>(run.status);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  useEffect(() => {
    void client
      .readAgentRunLog(run.id)
      .then((log) => setOutput(normalizeTerminalOutput(log)))
      .catch((error) => setTerminalError(errorMessage(error)));
  }, [client, run.id, run.status]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void client
      .onTerminalEvent((event) => {
        if (event.runId !== run.id) return;
        if (event.data) setOutput((current) => current + normalizeTerminalOutput(event.data ?? ''));
        if (event.status) setStatus(event.status);
      })
      .then((value) => {
        if (disposed) value();
        else unsubscribe = value;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [client, run.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [output]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || status !== 'running') return;
    const resize = () => {
      const cols = Math.max(24, Math.floor(panel.clientWidth / 7.5));
      const rows = Math.max(8, Math.floor(panel.clientHeight / 18));
      void client.terminalResize(run.id, cols, rows).catch(() => undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    resize();
    return () => observer.disconnect();
  }, [client, run.id, status]);

  const sendKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (status !== 'running') return;
    const data = terminalKey(event);
    if (!data) return;
    event.preventDefault();
    void client.terminalInput(run.id, data).catch((error) => setTerminalError(errorMessage(error)));
  };

  const stop = async () => {
    setTerminalError(null);
    try {
      await client.terminateAgentRun(run.id);
      setStatus('interrupted');
    } catch (error) {
      setTerminalError(errorMessage(error));
    }
  };

  const canComplete = run.action === 'fix_reply_resolve' && status !== 'running';
  const visibleError = actionError ?? terminalError;

  return (
    <section
      className="sticky bottom-0 z-4 mx-6 mb-6 overflow-hidden rounded-md border border-[oklch(31%_0.014_128)] bg-[oklch(18%_0.012_128)] text-[oklch(91%_0.01_128)] shadow-float"
      aria-label="Interactive terminal"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[oklch(31%_0.014_128)] bg-[oklch(22%_0.012_128)] px-3 py-[9px]">
        <div className="flex min-w-0 items-center gap-3">
          <span className={terminalStatusVariants({ status })}>
            <Icon name={statusIcon(status)} size={13} />
            {statusLabel(status)}
          </span>
          <strong>
            {run.agent === 'shell' ? 'Worktree terminal' : `${agentLabel(run.agent)} session`}
          </strong>
          <span className="text-[0.7rem] text-[oklch(67%_0.008_128)]">
            {formatRelativeTime(run.startedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status === 'running' ? (
            <Button
              className="border-[oklch(39%_0.012_128)] bg-[oklch(27%_0.012_128)] text-[oklch(92%_0.008_128)] hover:bg-[oklch(31%_0.014_128)] hover:text-[oklch(92%_0.008_128)]"
              variant="outline"
              type="button"
              onClick={() => void stop()}
            >
              Stop session
            </Button>
          ) : null}
          {canComplete ? (
            <Button type="button" disabled={actionBusy} onClick={() => onComplete(run.id)}>
              {actionBusy ? 'Posting reply…' : 'Complete and resolve'}
            </Button>
          ) : null}
          <button
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm border border-[oklch(39%_0.012_128)] bg-[oklch(27%_0.012_128)] text-[oklch(92%_0.008_128)] transition-[background,color,transform] duration-state ease-out hover:bg-[oklch(31%_0.014_128)] active:scale-[0.94]"
            type="button"
            aria-label="Close terminal"
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </header>
      <div
        className="grid min-h-[220px] max-h-[380px] grid-rows-[minmax(0,1fr)_auto]"
        ref={panelRef}
      >
        <pre
          className="m-0 min-h-[180px] overflow-auto px-4 py-3 font-mono text-xs leading-normal whitespace-pre-wrap text-[oklch(90%_0.01_128)]"
          ref={viewportRef}
        >
          {output || 'Waiting for terminal output…'}
        </pre>
        <input
          className="w-full border-0 border-t border-[oklch(31%_0.014_128)] bg-[oklch(20%_0.012_128)] px-4 py-[9px] font-mono text-xs text-[oklch(92%_0.008_128)] outline-none placeholder:text-[oklch(62%_0.008_128)]"
          type="text"
          aria-label="Terminal input"
          autoComplete="off"
          disabled={status !== 'running'}
          onKeyDown={sendKey}
          onPaste={(event) => {
            if (status !== 'running') return;
            event.preventDefault();
            void client.terminalInput(run.id, event.clipboardData.getData('text'));
          }}
          placeholder={
            status === 'running' ? 'Click here and type in the terminal' : 'Session ended'
          }
        />
      </div>
      {run.worktreePath ? (
        <footer className="flex items-center gap-3 overflow-hidden border-t border-[oklch(31%_0.014_128)] bg-[oklch(22%_0.012_128)] px-3 py-[9px] font-mono text-[0.65rem] text-[oklch(67%_0.008_128)]">
          <Icon name="branch" size={13} />
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap"
            title={run.worktreePath}
          >
            {run.worktreePath}
          </span>
        </footer>
      ) : null}
      {visibleError ? (
        <p
          className="m-0 flex items-start gap-1.5 px-3 pb-3 text-[0.73rem] text-[oklch(76%_0.15_29)]"
          role="alert"
        >
          <Icon name="alert" size={14} />
          {visibleError}
        </p>
      ) : null}
    </section>
  );
}

const terminalStatusVariants = cva(
  'inline-flex items-center gap-[5px] text-[0.72rem] font-semibold text-ink-secondary',
  {
    variants: {
      status: {
        running: 'text-[oklch(80%_0.13_84)]',
        completed: 'text-[oklch(77%_0.14_143)]',
        failed: 'text-[oklch(73%_0.16_29)]',
        interrupted: 'text-[oklch(73%_0.16_29)]',
        stalled: 'text-[oklch(73%_0.16_29)]',
      },
    },
  },
);

function terminalKey(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.ctrlKey && event.key.length === 1) {
    return String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64);
  }
  const special: Record<string, string> = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
  };
  return special[event.key] ?? (event.key.length === 1 ? event.key : null);
}

function normalizeTerminalOutput(value: string): string {
  // PTY output intentionally contains ANSI and OSC control sequences.
  /* eslint-disable no-control-regex */
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n');
  /* eslint-enable no-control-regex */
}

function statusIcon(status: AgentRunStatus) {
  if (status === 'completed') return 'check' as const;
  if (status === 'running') return 'sync' as const;
  return 'alert' as const;
}

function statusLabel(status: AgentRunStatus) {
  return status.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

function agentLabel(agent: AgentRun['agent']) {
  if (agent === 'claude_code') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return 'Shell';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
