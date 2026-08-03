import { useMemo } from 'react';
import { ActivationFlow } from './components/ActivationFlow';
import { AppRail } from './components/AppRail';
import { Icon } from './components/Icon';
import { InboxWorkspace } from './components/InboxWorkspace';
import { useMissionControl } from './hooks/useMissionControl';
import { createMissionControlClient } from './lib/client';

export function App() {
  const client = useMemo(() => createMissionControlClient(), []);
  const model = useMissionControl(client);

  return (
    <div
      className="app-frame"
      data-mission-control-foundation={model.foundation?.settingsSchemaVersion ?? 'loading'}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppRail />

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
            busy={model.activationBusy}
            error={model.activationError}
            onBeginAuthorization={() => void model.beginAuthorization()}
            onSynchronize={() => void model.synchronizeActivation()}
            onOpenUrl={(url) => void model.openExternalUrl(url)}
          />
        ) : null
      ) : null}

      {!model.isBooting && !model.bootError && model.activation?.step === 'ready' ? (
        <InboxWorkspace
          githubLogin={model.activation.githubLogin}
          pullRequests={model.pullRequests}
          attentionItems={model.attentionItems}
          loaded={model.inboxLoaded}
          refreshing={model.isRefreshing}
          refreshError={model.refreshError}
          lastCompletedSync={model.lastCompletedSync}
          onRefresh={() => void model.refreshInbox()}
          onOpenUrl={(url) => void model.openExternalUrl(url)}
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
