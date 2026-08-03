import type { ActivationState, DeviceAuthorization } from '../contracts';
import { Icon } from './Icon';

interface ActivationFlowProps {
  activation: ActivationState;
  authorization: DeviceAuthorization | null;
  authorizationPhase: 'idle' | 'starting' | 'waiting' | 'authorized';
  busy: boolean;
  error: string | null;
  onBeginAuthorization(): void;
  onSynchronize(): void;
  onOpenUrl(url: string): void;
}

const installationSettingsUrl = 'https://github.com/settings/installations';

export function ActivationFlow({
  activation,
  authorization,
  authorizationPhase,
  busy,
  error,
  onBeginAuthorization,
  onSynchronize,
  onOpenUrl,
}: ActivationFlowProps) {
  const connected = activation.githubLogin !== null;
  const repositoryAccess = activation.accessibleRepositoryCount > 0;
  const complete = activation.initialSyncCompleted;

  return (
    <main className="activation" id="main-content">
      <section className="activation__intro" aria-labelledby="activation-title">
        <div className="activation__eyebrow">
          <Icon name="spark" size={15} />
          First run
        </div>
        <h1 id="activation-title">See what needs you.</h1>
        <p>
          Connect GitHub and Mission Control will build a live inbox from your authored and
          review-requested pull requests.
        </p>
        <div className="activation__promise">
          <span className="activation__promise-mark">
            <Icon name="check" size={14} strokeWidth={2.4} />
          </span>
          Tokens stay in your system keychain. Monitoring stays on this Mac.
        </div>
      </section>

      <section className="activation-panel" aria-label="Activation progress">
        <div className="activation-panel__header">
          <div>
            <span className="activation-panel__step">Setup</span>
            <h2>Start with GitHub</h2>
          </div>
          <span className="activation-panel__count">
            {[connected, repositoryAccess, complete].filter(Boolean).length}/3
          </span>
        </div>

        <ol className="setup-list">
          <SetupStep
            number={1}
            title="Connect your account"
            description={
              connected
                ? `Connected as @${activation.githubLogin}`
                : 'Authorize with GitHub Device Flow'
            }
            state={connected ? 'complete' : 'current'}
          />
          <SetupStep
            number={2}
            title="Confirm repository access"
            description={
              repositoryAccess
                ? `${activation.accessibleRepositoryCount} repositories available`
                : 'Use the repositories already granted to the GitHub App'
            }
            state={repositoryAccess ? 'complete' : connected ? 'current' : 'upcoming'}
          />
          <SetupStep
            number={3}
            title="Build your attention inbox"
            description={
              complete
                ? 'Initial scan complete'
                : 'Find review requests, threads, and failing checks'
            }
            state={complete ? 'complete' : repositoryAccess ? 'current' : 'upcoming'}
          />
        </ol>

        <div className="activation-action">
          {activation.step === 'github_app_configuration_required' ? (
            <InlineError message="This build is missing its GitHub App configuration." />
          ) : null}

          {activation.step === 'github_authorization_required' && authorizationPhase === 'idle' ? (
            <button
              className="button button--primary button--wide"
              type="button"
              onClick={onBeginAuthorization}
            >
              <Icon name="github" size={17} />
              Connect GitHub
            </button>
          ) : null}

          {authorizationPhase === 'starting' ? (
            <button className="button button--primary button--wide" type="button" disabled>
              <span className="spinner" />
              Starting authorization
            </button>
          ) : null}

          {authorization && authorizationPhase === 'waiting' ? (
            <DeviceCode
              authorization={authorization}
              onOpen={() => onOpenUrl(authorization.verificationUri)}
            />
          ) : null}

          {authorizationPhase === 'authorized' && busy ? (
            <div className="activation-working" role="status">
              <span className="spinner spinner--dark" />
              GitHub connected. Building your inbox now.
            </div>
          ) : null}

          {activation.step === 'repository_access_required' && authorizationPhase !== 'waiting' ? (
            <div className="activation-action__stack">
              <button
                className="button button--primary button--wide"
                type="button"
                onClick={onSynchronize}
                disabled={busy}
              >
                {busy ? <span className="spinner" /> : <Icon name="sync" size={16} />}
                {busy ? 'Checking access' : 'Check access and continue'}
              </button>
              <button
                className="button button--quiet button--wide"
                type="button"
                onClick={() => onOpenUrl(installationSettingsUrl)}
              >
                Manage GitHub access
                <Icon name="arrow-up-right" size={15} />
              </button>
            </div>
          ) : null}

          {activation.step === 'initial_sync_required' ? (
            <button
              className="button button--primary button--wide"
              type="button"
              onClick={onSynchronize}
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : <Icon name="sync" size={16} />}
              {busy ? 'Scanning pull requests' : 'Build attention inbox'}
            </button>
          ) : null}

          {error ? <InlineError message={error} /> : null}
        </div>
      </section>
    </main>
  );
}

function SetupStep({
  number,
  title,
  description,
  state,
}: {
  number: number;
  title: string;
  description: string;
  state: 'complete' | 'current' | 'upcoming';
}) {
  return (
    <li className={`setup-step setup-step--${state}`}>
      <span className="setup-step__mark" aria-hidden="true">
        {state === 'complete' ? <Icon name="check" size={14} strokeWidth={2.5} /> : number}
      </span>
      <span className="setup-step__copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="setup-step__state">
        {state === 'complete' ? 'Done' : state === 'current' ? 'Current' : 'Later'}
      </span>
    </li>
  );
}

function DeviceCode({
  authorization,
  onOpen,
}: {
  authorization: DeviceAuthorization;
  onOpen(): void;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(authorization.userCode);
  };

  return (
    <div className="device-code">
      <div className="device-code__heading">
        <span>
          <Icon name="clock" size={15} />
          Waiting for GitHub
        </span>
        <span className="device-code__pulse" />
      </div>
      <p>Enter this one-time code in the browser window.</p>
      <div className="device-code__value">
        <code>{authorization.userCode}</code>
        <button
          className="icon-button"
          type="button"
          aria-label="Copy device code"
          onClick={() => void copy()}
        >
          <Icon name="copy" size={16} />
        </button>
      </div>
      <button className="button button--primary button--wide" type="button" onClick={onOpen}>
        Open GitHub
        <Icon name="arrow-up-right" size={15} />
      </button>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
    </div>
  );
}
