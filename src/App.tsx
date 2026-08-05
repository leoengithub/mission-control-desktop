import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivationFlow } from './components/ActivationFlow';
import { Icon } from './components/Icon';
import { InboxWorkspace } from './components/InboxWorkspace';
import { SettingsWorkspace } from './components/SettingsWorkspace';
import { useMissionControl } from './hooks/useMissionControl';
import { useReviewWorkflow } from './hooks/useReviewWorkflow';
import { createMissionControlClient } from './lib/client';
import type { ContextualPrompt } from './contracts';

type AppView = 'reviews' | 'settings';

export function App() {
  const client = useMemo(() => createMissionControlClient(), []);
  const [activeView, setActiveView] = useState<AppView>('reviews');
  const [selectedPullRequestId, setSelectedPullRequestId] = useState<string | null>(null);
  const openPullRequest = useCallback((pullRequestId: string) => {
    setSelectedPullRequestId(pullRequestId);
    setActiveView('reviews');
  }, []);
  const model = useMissionControl(client, openPullRequest);
  const effectivePullRequestId = model.pullRequests.some(
    (pullRequest) => pullRequest.id === selectedPullRequestId,
  )
    ? selectedPullRequestId
    : (model.pullRequests[0]?.id ?? null);
  const reviewWorkflow = useReviewWorkflow(
    client,
    effectivePullRequestId,
    model.settings?.agents.defaultAgent ?? null,
  );
  const reloadWorkspaceSupport = reviewWorkflow.reloadWorkspaceSupport;
  useEffect(() => {
    if (model.activation?.step === 'repository_selection_required') {
      void reloadWorkspaceSupport();
    }
  }, [model.activation?.step, reloadWorkspaceSupport]);

  const updateRepositoryMonitoring = useCallback(
    async (repositoryIds: string[]) => {
      const updated = await reviewWorkflow.setRepositoryMonitoring(repositoryIds);
      if (updated) await model.refreshInbox();
      return updated;
    },
    [model, reviewWorkflow],
  );

  const completeRepositorySelection = useCallback(
    async (repositoryIds: string[]) => {
      const updated = await reviewWorkflow.setRepositoryMonitoring(repositoryIds);
      if (updated) await model.synchronizeActivation();
    },
    [model, reviewWorkflow],
  );
  const enableContextualPrompt = useCallback(
    async (prompt: ContextualPrompt) => {
      if (prompt === 'enable_notifications') {
        await model.setNotificationsEnabled(true);
        return;
      }
      if (prompt === 'enable_launch_at_login' && model.settings) {
        await model.saveSettings({
          general: { ...model.settings.general, launchAtLogin: true },
        });
        return;
      }
      setActiveView('settings');
    },
    [model],
  );

  return (
    <div
      className="app-frame"
      data-mission-control-foundation={model.foundation?.settingsSchemaVersion ?? 'loading'}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {model.isBooting ? <BootScreen /> : null}

      {!model.isBooting && model.bootError ? (
        <FatalState message={model.bootError} onRetry={() => void model.retryBootstrap()} />
      ) : null}

      {!model.isBooting && !model.bootError && model.activation?.step !== 'ready' ? (
        model.activation ? (
          <ActivationFlow
            activation={model.activation}
            authorization={model.authorization}
            authorizationPhase={model.authorizationPhase}
            busy={model.activationBusy || model.accountBusy}
            error={model.accountError ?? model.activationError}
            repositories={reviewWorkflow.repositories}
            repositorySelectionBusy={
              reviewWorkflow.actionStates['repository-monitoring'] === 'running'
            }
            repositorySelectionError={reviewWorkflow.actionErrors['repository-monitoring'] ?? null}
            onBeginAuthorization={() => void model.beginAuthorization()}
            onCancelAuthorization={() => void model.cancelAuthorization()}
            onSwitchAccount={() => void model.switchAccount()}
            onSynchronize={() => void model.synchronizeActivation()}
            onCompleteRepositorySelection={(repositoryIds) =>
              void completeRepositorySelection(repositoryIds)
            }
            onOpenUrl={(url) => void model.openExternalUrl(url)}
          />
        ) : null
      ) : null}

      {!model.isBooting &&
      !model.bootError &&
      model.activation?.step === 'ready' &&
      activeView === 'reviews' ? (
        <InboxWorkspace
          githubLogin={model.activation.githubLogin}
          pullRequests={model.pullRequests}
          attentionItems={model.attentionItems}
          loaded={model.inboxLoaded}
          refreshing={model.isRefreshing}
          refreshError={model.refreshError}
          lastCompletedSync={model.lastCompletedSync}
          selectedPullRequestId={effectivePullRequestId}
          contextualPrompt={model.contextualPrompts[0] ?? null}
          reviewWorkflow={reviewWorkflow}
          client={client}
          onRefresh={() => void model.refreshInbox()}
          onOpenUrl={(url) => void model.openExternalUrl(url)}
          onSelectPullRequest={setSelectedPullRequestId}
          onEnableContextualPrompt={(prompt) => void enableContextualPrompt(prompt)}
          onDismissContextualPrompt={(prompt) => void model.dismissContextualPrompt(prompt)}
          onOpenSettings={() => setActiveView('settings')}
        />
      ) : null}

      {!model.isBooting &&
      !model.bootError &&
      model.activation?.step === 'ready' &&
      activeView === 'settings' ? (
        <SettingsWorkspace
          settings={model.settings}
          notificationPermission={model.notificationPermission}
          saveState={model.settingsSaveState}
          error={model.accountError ?? model.settingsError}
          repositories={reviewWorkflow.repositories}
          agents={reviewWorkflow.agents}
          actionStates={reviewWorkflow.actionStates}
          actionErrors={reviewWorkflow.actionErrors}
          githubLogin={model.activation.githubLogin}
          accountBusy={model.accountBusy}
          onBack={() => setActiveView('reviews')}
          onSave={(patch) => void model.saveSettings(patch)}
          onNotificationsEnabled={(enabled) => void model.setNotificationsEnabled(enabled)}
          onAttachRepository={(repositoryId, localPath) =>
            void reviewWorkflow.attachRepository(repositoryId, localPath)
          }
          onSetRepositoryMonitoring={(repositoryIds) =>
            void updateRepositoryMonitoring(repositoryIds)
          }
          onOpenUrl={(url) => void model.openExternalUrl(url)}
          onSwitchAccount={() => void model.switchAccount()}
          onDisconnectAccount={() => void model.disconnectAccount()}
        />
      ) : null}
    </div>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen" id="main-content" aria-label="Opening Mission Control">
      <div className="boot-screen__mark">
        <Icon name="branch" size={22} strokeWidth={2.1} />
      </div>
      <div className="boot-screen__copy">
        <strong>Mission Control</strong>
        <span>Opening your local attention inbox</span>
      </div>
      <span className="boot-screen__progress" />
    </main>
  );
}

function FatalState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <main className="fatal-state" id="main-content">
      <span className="fatal-state__mark">
        <Icon name="alert" size={22} />
      </span>
      <h1>Mission Control could not open</h1>
      <p>{message}</p>
      <button className="button button--primary" type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
