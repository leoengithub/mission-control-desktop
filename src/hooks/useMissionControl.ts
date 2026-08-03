import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivationState,
  AttentionItem,
  CachedPullRequest,
  DeviceAuthorization,
  FoundationStatus,
} from '../contracts';
import type { MissionControlClient } from '../lib/client';

type AuthorizationPhase = 'idle' | 'starting' | 'waiting' | 'authorized';

export function useMissionControl(client: MissionControlClient) {
  const mountedRef = useRef(true);
  const refreshLockRef = useRef(false);
  const [foundation, setFoundation] = useState<FoundationStatus | null>(null);
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<DeviceAuthorization | null>(null);
  const [authorizationPhase, setAuthorizationPhase] = useState<AuthorizationPhase>('idle');
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [pullRequests, setPullRequests] = useState<CachedPullRequest[]>([]);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastCompletedSync, setLastCompletedSync] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCachedInbox = useCallback(async () => {
    const [nextPullRequests, nextAttentionItems] = await Promise.all([
      client.listPullRequests(),
      client.listAttentionItems(),
    ]);
    if (!mountedRef.current) return;
    setPullRequests(nextPullRequests);
    setAttentionItems(nextAttentionItems);
    setInboxLoaded(true);
  }, [client]);

  const bootstrap = useCallback(async () => {
    setIsBooting(true);
    setBootError(null);
    try {
      const [nextFoundation, nextActivation] = await Promise.all([
        client.getFoundationStatus(),
        client.getActivationState(),
      ]);
      if (!mountedRef.current) return;
      setFoundation(nextFoundation);
      setActivation(nextActivation);
      if (nextActivation.step === 'ready') {
        await loadCachedInbox();
      }
    } catch (error) {
      if (mountedRef.current) {
        setBootError(errorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setIsBooting(false);
      }
    }
  }, [client, loadCachedInbox]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void bootstrap();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bootstrap]);

  const synchronizeActivation = useCallback(async () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setActivationBusy(true);
    setActivationError(null);
    try {
      const result = await client.refreshInbox();
      const nextActivation = await client.getActivationState();
      if (!mountedRef.current) return;
      setLastCompletedSync(result.completedAt);
      setActivation(nextActivation);
      if (nextActivation.step === 'ready') {
        await loadCachedInbox();
      } else if (nextActivation.step === 'repository_access_required') {
        setActivationError(
          'Mission Control cannot see a repository yet. Grant the GitHub App access, then check again.',
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        setActivationError(errorMessage(error));
      }
    } finally {
      refreshLockRef.current = false;
      if (mountedRef.current) {
        setActivationBusy(false);
      }
    }
  }, [client, loadCachedInbox]);

  const beginAuthorization = useCallback(async () => {
    setAuthorizationPhase('starting');
    setActivationError(null);
    try {
      const nextAuthorization = await client.startGithubAuthorization();
      if (!mountedRef.current) return;
      setAuthorization(nextAuthorization);
      setAuthorizationPhase('waiting');
      await client.openExternalUrl(nextAuthorization.verificationUri);
    } catch (error) {
      if (mountedRef.current) {
        setAuthorizationPhase('idle');
        setActivationError(errorMessage(error));
      }
    }
  }, [client]);

  useEffect(() => {
    if (!authorization || authorizationPhase !== 'waiting') return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const result = await client.pollGithubAuthorization(authorization.sessionId);
        if (cancelled || !mountedRef.current) return;
        if (result.state === 'pending') {
          timer = window.setTimeout(poll, result.retryAfterSeconds * 1000);
          return;
        }
        setAuthorizationPhase('authorized');
        setActivation((current) =>
          current
            ? {
                ...current,
                githubLogin: result.login,
                step: 'repository_access_required',
              }
            : current,
        );
        await synchronizeActivation();
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setAuthorizationPhase('idle');
          setActivationError(errorMessage(error));
        }
      }
    };

    timer = window.setTimeout(poll, authorization.pollIntervalSeconds * 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [authorization, authorizationPhase, client, synchronizeActivation]);

  const refreshInbox = useCallback(async () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const result = await client.refreshInbox();
      if (!mountedRef.current) return;
      setLastCompletedSync(result.completedAt);
      await loadCachedInbox();
    } catch (error) {
      if (mountedRef.current) {
        setRefreshError(errorMessage(error));
      }
    } finally {
      refreshLockRef.current = false;
      if (mountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [client, loadCachedInbox]);

  useEffect(() => {
    if (activation?.step !== 'ready') return;
    const cacheTimer = window.setInterval(() => {
      void loadCachedInbox().catch((error) => setRefreshError(errorMessage(error)));
    }, 15_000);
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void refreshInbox();
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearInterval(cacheTimer);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [activation?.step, loadCachedInbox, refreshInbox]);

  return {
    foundation,
    activation,
    isBooting,
    bootError,
    authorization,
    authorizationPhase,
    activationBusy,
    activationError,
    pullRequests,
    attentionItems,
    inboxLoaded,
    isRefreshing,
    refreshError,
    lastCompletedSync,
    retryBootstrap: bootstrap,
    beginAuthorization,
    synchronizeActivation,
    refreshInbox,
    loadCachedInbox,
    openExternalUrl: client.openExternalUrl,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
