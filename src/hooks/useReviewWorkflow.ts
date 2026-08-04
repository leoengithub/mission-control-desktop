import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentAvailability,
  AgentKind,
  AgentRun,
  LocalRepositoryAttachment,
  PullRequestReviewDetail,
} from '../contracts';
import type { MissionControlClient } from '../lib/client';

export type ReviewActionState = 'idle' | 'running' | 'error';

export function useReviewWorkflow(
  client: MissionControlClient,
  pullRequestId: string | null,
  defaultAgent: AgentKind | null,
) {
  const mountedRef = useRef(true);
  const [detail, setDetail] = useState<PullRequestReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<LocalRepositoryAttachment[]>([]);
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentKind | null>(defaultAgent);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, ReviewActionState>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadWorkspaceSupport = useCallback(async () => {
    const [nextRepositories, nextAgents] = await Promise.all([
      client.listLocalRepositories(),
      client.detectAgents(),
    ]);
    if (!mountedRef.current) return;
    setRepositories(nextRepositories);
    setAgents(nextAgents);
    setSelectedAgent((current) => {
      if (current && nextAgents.some((agent) => agent.agent === current && agent.available)) {
        return current;
      }
      if (
        defaultAgent &&
        nextAgents.some((agent) => agent.agent === defaultAgent && agent.available)
      ) {
        return defaultAgent;
      }
      return nextAgents.find((agent) => agent.available)?.agent ?? null;
    });
  }, [client, defaultAgent]);

  const loadReview = useCallback(async () => {
    if (!pullRequestId) {
      setDetail(null);
      setRuns([]);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [nextDetail, nextRuns] = await Promise.all([
        client.getPullRequestReviewDetail(pullRequestId),
        client.listAgentRuns(pullRequestId),
      ]);
      if (!mountedRef.current) return;
      setDetail(nextDetail);
      setRuns(nextRuns);
      await client.markPullRequestSeen(pullRequestId);
    } catch (error) {
      if (mountedRef.current) setDetailError(errorMessage(error));
    } finally {
      if (mountedRef.current) setDetailLoading(false);
    }
  }, [client, pullRequestId]);

  useEffect(() => {
    void loadWorkspaceSupport().catch((error) => {
      if (mountedRef.current) setDetailError(errorMessage(error));
    });
  }, [loadWorkspaceSupport]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void client
      .onTerminalEvent((event) => {
        if (event.kind !== 'exit' || event.runId !== activeRun?.id || !pullRequestId) return;
        void client.listAgentRuns(pullRequestId).then((nextRuns) => {
          if (!disposed && mountedRef.current) {
            setRuns(nextRuns);
            setActiveRun(nextRuns.find((run) => run.id === event.runId) ?? null);
          }
        });
      })
      .then((value) => {
        if (disposed) value();
        else unsubscribe = value;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [activeRun?.id, client, pullRequestId]);

  const runAction = useCallback(
    async <T>(key: string, operation: () => Promise<T>): Promise<T | null> => {
      setActionStates((current) => ({ ...current, [key]: 'running' }));
      setActionErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      try {
        const result = await operation();
        if (mountedRef.current) setActionStates((current) => ({ ...current, [key]: 'idle' }));
        return result;
      } catch (error) {
        if (mountedRef.current) {
          setActionStates((current) => ({ ...current, [key]: 'error' }));
          setActionErrors((current) => ({ ...current, [key]: errorMessage(error) }));
        }
        return null;
      }
    },
    [],
  );

  const requireAgent = useCallback(() => {
    if (!selectedAgent) throw new Error('Install or select an available local agent first.');
    return selectedAgent;
  }, [selectedAgent]);

  const replyAndResolve = useCallback(
    async (threadId: string, existingRunId?: string) => {
      const result = await runAction(`thread:${threadId}`, () =>
        client.replyAndResolve(threadId, requireAgent(), existingRunId),
      );
      if (result) await loadReview();
      return result;
    },
    [client, loadReview, requireAgent, runAction],
  );

  const startFixSession = useCallback(
    async (threadId: string) => {
      const result = await runAction(`thread:${threadId}`, () =>
        client.startFixSession(threadId, requireAgent()),
      );
      if (result) {
        setActiveRun(result);
        setRuns((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      }
      return result;
    },
    [client, requireAgent, runAction],
  );

  const openTerminal = useCallback(
    async (threadId: string) => {
      const result = await runAction(`thread:${threadId}`, () =>
        client.openThreadTerminal(threadId),
      );
      if (result) {
        setActiveRun(result);
        setRuns((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      }
      return result;
    },
    [client, runAction],
  );

  const completeFixSession = useCallback(
    async (runId: string) => {
      const result = await runAction(`run:${runId}`, () => client.completeFixSession(runId));
      if (result) {
        setActiveRun(result);
        await loadReview();
      }
      return result;
    },
    [client, loadReview, runAction],
  );

  const requestCopilotReview = useCallback(async () => {
    if (!pullRequestId) return null;
    return runAction(`copilot:${pullRequestId}`, () => client.requestCopilotReview(pullRequestId));
  }, [client, pullRequestId, runAction]);

  const attachRepository = useCallback(
    async (repositoryId: string, localPath: string) => {
      const result = await runAction(`repository:${repositoryId}`, () =>
        client.attachLocalRepository(repositoryId, localPath),
      );
      if (result) await loadWorkspaceSupport();
      return result;
    },
    [client, loadWorkspaceSupport, runAction],
  );

  return {
    detail,
    detailLoading,
    detailError,
    repositories,
    agents,
    selectedAgent,
    runs,
    activeRun,
    actionStates,
    actionErrors,
    setSelectedAgent,
    setActiveRun,
    reload: loadReview,
    replyAndResolve,
    startFixSession,
    openTerminal,
    completeFixSession,
    requestCopilotReview,
    attachRepository,
  };
}

export type ReviewWorkflowModel = ReturnType<typeof useReviewWorkflow>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
