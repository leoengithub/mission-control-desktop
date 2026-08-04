import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivationState,
  AppSettings,
  AttentionItem,
  CachedPullRequest,
  ContextualPrompt,
  DeviceAuthorization,
  FoundationStatus,
  NotificationPermission,
  SettingsPatch,
  SyncTrigger,
} from '../contracts';
import type { MissionControlClient } from '../lib/client';

type AuthorizationPhase = 'idle' | 'starting' | 'waiting' | 'authorized';

type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useMissionControl(
  client: MissionControlClient,
  onOpenPullRequest: (pullRequestId: string) => void,
) {
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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>('prompt');
  const [contextualPrompts, setContextualPrompts] = useState<ContextualPrompt[]>([]);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

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

  const loadContextualPrompts = useCallback(async () => {
    const prompts = await client.listContextualPrompts();
    if (mountedRef.current) setContextualPrompts(prompts);
  }, [client]);

  const bootstrap = useCallback(async () => {
    setIsBooting(true);
    setBootError(null);
    try {
      const [nextFoundation, nextActivation, nextSettings, nextPermission] = await Promise.all([
        client.getFoundationStatus(),
        client.getActivationState(),
        client.getSettings(),
        client.getNotificationPermission(),
      ]);
      if (!mountedRef.current) return;
      setFoundation(nextFoundation);
      setActivation(nextActivation);
      setSettings(nextSettings);
      setNotificationPermission(nextPermission);
      if (nextActivation.step === 'ready') {
        await loadCachedInbox();
        await loadContextualPrompts();
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
  }, [client, loadCachedInbox, loadContextualPrompts]);

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
      const result = await client.refreshInbox('activation');
      const nextActivation = await client.getActivationState();
      if (!mountedRef.current) return;
      setLastCompletedSync(result.completedAt);
      setActivation(nextActivation);
      if (nextActivation.step === 'ready') {
        await loadCachedInbox();
        await loadContextualPrompts();
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
  }, [client, loadCachedInbox, loadContextualPrompts]);

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

  const cancelAuthorization = useCallback(async () => {
    const sessionId = authorization?.sessionId;
    setAuthorization(null);
    setAuthorizationPhase('idle');
    setActivationError(null);
    if (!sessionId) return;
    try {
      await client.cancelGithubAuthorization(sessionId);
    } catch (error) {
      if (mountedRef.current) setActivationError(errorMessage(error));
    }
  }, [authorization?.sessionId, client]);

  const disconnectAccount = useCallback(async () => {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const nextActivation = await client.disconnectGithubAccount();
      if (!mountedRef.current) return false;
      setActivation(nextActivation);
      setAuthorization(null);
      setAuthorizationPhase('idle');
      setPullRequests([]);
      setAttentionItems([]);
      setInboxLoaded(false);
      setContextualPrompts([]);
      setLastCompletedSync(null);
      return true;
    } catch (error) {
      if (mountedRef.current) setAccountError(errorMessage(error));
      return false;
    } finally {
      if (mountedRef.current) setAccountBusy(false);
    }
  }, [client]);

  const switchAccount = useCallback(async () => {
    const disconnected = await disconnectAccount();
    if (disconnected && mountedRef.current) await beginAuthorization();
  }, [beginAuthorization, disconnectAccount]);

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

  const refreshInbox = useCallback(
    async (trigger: SyncTrigger = 'manual') => {
      if (refreshLockRef.current) return;
      refreshLockRef.current = true;
      setIsRefreshing(true);
      setRefreshError(null);
      try {
        const result = await client.refreshInbox(trigger);
        if (!mountedRef.current) return;
        setLastCompletedSync(result.completedAt);
        await loadCachedInbox();
        await loadContextualPrompts();
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
    },
    [client, loadCachedInbox, loadContextualPrompts],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    void Promise.all([
      client.onInboxSync((event) => {
        if (!mountedRef.current) return;
        if (event.status === 'completed') {
          setLastCompletedSync(event.result?.completedAt ?? null);
          setRefreshError(null);
          if (event.trigger === 'background') {
            void loadCachedInbox()
              .then(loadContextualPrompts)
              .catch((error) => setRefreshError(errorMessage(error)));
          }
          return;
        }
        const retry = event.retryAfterSeconds
          ? ` Mission Control will retry in ${formatRetryDelay(event.retryAfterSeconds)}.`
          : '';
        setRefreshError(`${event.error ?? 'GitHub synchronization failed.'}${retry}`);
      }),
      client.onOpenPullRequest((event) => onOpenPullRequest(event.pullRequestId)),
      client.onTerminalEvent((event) => {
        if (event.kind !== 'exit') return;
        void loadCachedInbox().catch((error) => setRefreshError(errorMessage(error)));
      }),
    ])
      .then((nextUnsubscribers) => {
        if (disposed) {
          nextUnsubscribers.forEach((unsubscribe) => unsubscribe());
        } else {
          unsubscribers.push(...nextUnsubscribers);
        }
      })
      .catch((error) => {
        if (!disposed && mountedRef.current) setRefreshError(errorMessage(error));
      });
    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, loadCachedInbox, loadContextualPrompts, onOpenPullRequest]);

  useEffect(() => {
    if (activation?.step !== 'ready') return;
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void refreshInbox('focus');
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [activation?.step, refreshInbox]);

  const saveSettings = useCallback(
    async (patch: SettingsPatch) => {
      setSettingsSaveState('saving');
      setSettingsError(null);
      try {
        const updated = await client.updateSettings(patch);
        if (!mountedRef.current) return null;
        setSettings(updated);
        setSettingsSaveState('saved');
        await loadContextualPrompts();
        return updated;
      } catch (error) {
        if (mountedRef.current) {
          setSettingsSaveState('error');
          setSettingsError(errorMessage(error));
        }
        return null;
      }
    },
    [client, loadContextualPrompts],
  );

  const setNotificationsEnabled = useCallback(
    async (enabled: boolean) => {
      if (!settings) return false;
      if (enabled) {
        let permission: NotificationPermission;
        try {
          permission = await client.requestNotificationPermission();
        } catch (error) {
          if (mountedRef.current) {
            setSettingsSaveState('error');
            setSettingsError(errorMessage(error));
          }
          return false;
        }
        if (!mountedRef.current) return false;
        setNotificationPermission(permission);
        if (permission !== 'granted') {
          setSettingsSaveState('error');
          setSettingsError(
            permission === 'denied'
              ? 'Notifications are blocked in system settings.'
              : 'Notification permission is required before alerts can be enabled.',
          );
          return false;
        }
      }
      return Boolean(
        await saveSettings({
          notifications: { ...settings.notifications, enabled },
        }),
      );
    },
    [client, saveSettings, settings],
  );

  const dismissContextualPrompt = useCallback(
    async (prompt: ContextualPrompt) => {
      if (!settings) return;
      const dismissed = Array.from(new Set([...settings.dismissedContextualPrompts, prompt]));
      await saveSettings({ dismissedContextualPrompts: dismissed });
    },
    [saveSettings, settings],
  );

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
    settings,
    notificationPermission,
    contextualPrompts,
    settingsSaveState,
    settingsError,
    accountBusy,
    accountError,
    retryBootstrap: bootstrap,
    beginAuthorization,
    cancelAuthorization,
    disconnectAccount,
    switchAccount,
    synchronizeActivation,
    refreshInbox: () => refreshInbox('manual'),
    loadCachedInbox,
    saveSettings,
    setNotificationsEnabled,
    dismissContextualPrompt,
    openExternalUrl: client.openExternalUrl,
  };
}

function formatRetryDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
