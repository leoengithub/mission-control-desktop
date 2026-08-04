import { useEffect, useRef, useState } from 'react';
import type { AgentRun, AgentRunStatus } from '../contracts';
import type { MissionControlClient } from '../lib/client';
import { formatRelativeTime } from '../lib/inbox';
import { Icon } from './Icon';

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
    <section className="terminal-panel" aria-label="Interactive terminal">
      <header className="terminal-panel__header">
        <div>
          <span className={`terminal-status terminal-status--${status}`}>
            <Icon name={statusIcon(status)} size={13} />
            {statusLabel(status)}
          </span>
          <strong>
            {run.agent === 'shell' ? 'Worktree terminal' : `${agentLabel(run.agent)} session`}
          </strong>
          <span>{formatRelativeTime(run.startedAt)}</span>
        </div>
        <div className="terminal-panel__actions">
          {status === 'running' ? (
            <button className="button button--quiet" type="button" onClick={() => void stop()}>
              Stop session
            </button>
          ) : null}
          {canComplete ? (
            <button
              className="button button--primary"
              type="button"
              disabled={actionBusy}
              onClick={() => onComplete(run.id)}
            >
              {actionBusy ? 'Posting reply…' : 'Complete and resolve'}
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            aria-label="Close terminal"
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </header>
      <div className="terminal-panel__viewport" ref={panelRef}>
        <pre ref={viewportRef}>{output || 'Waiting for terminal output…'}</pre>
        <input
          className="terminal-panel__input"
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
        <footer className="terminal-panel__footer">
          <Icon name="branch" size={13} />
          <span title={run.worktreePath}>{run.worktreePath}</span>
        </footer>
      ) : null}
      {visibleError ? (
        <p className="terminal-panel__error" role="alert">
          <Icon name="alert" size={14} />
          {visibleError}
        </p>
      ) : null}
    </section>
  );
}

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
