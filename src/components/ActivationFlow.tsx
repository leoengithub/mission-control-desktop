import { useMemo, useState } from 'react';
import type { ActivationState, LocalRepositoryAttachment } from '../contracts';
import { Icon } from './Icon';
import onboardingHero from '../../assets/brand/raster/onboarding-hero.png';
import { Checkbox } from '@/components/ui/checkbox';

interface ActivationFlowProps {
  activation: ActivationState;
  githubCliAvailable: boolean;
  busy: boolean;
  error: string | null;
  repositories: LocalRepositoryAttachment[];
  repositorySelectionBusy: boolean;
  repositorySelectionError: string | null;
  onConnectAccount(): void;
  onSwitchAccount(): void;
  onSynchronize(): void;
  onCompleteRepositorySelection(repositoryIds: string[]): void;
  onOpenUrl(url: string): void;
}

const githubCliUrl = 'https://cli.github.com/';
const githubCliAuthUrl = 'https://cli.github.com/manual/gh_auth_login';
const githubSsoUrl =
  'https://docs.github.com/en/authentication/authenticating-with-single-sign-on/authorizing-an-app-for-single-sign-on';

export function ActivationFlow({
  activation,
  githubCliAvailable,
  busy,
  error,
  repositories,
  repositorySelectionBusy,
  repositorySelectionError,
  onConnectAccount,
  onSwitchAccount,
  onSynchronize,
  onCompleteRepositorySelection,
  onOpenUrl,
}: ActivationFlowProps) {
  const connected = activation.githubLogin !== null;
  const repositoryAccess = activation.accessibleRepositoryCount > 0;
  const repositoriesSelected = activation.repositorySelectionCompleted;
  const complete = activation.initialSyncCompleted;

  return (
    <main className="activation" id="main-content" data-tauri-drag-region>
      <section className="activation__intro" aria-labelledby="activation-title">
        <div className="activation__eyebrow">
          <Icon name="spark" size={15} />
          First run
        </div>
        <h1 id="activation-title">See what needs you.</h1>
        <p>
          Use your GitHub CLI account and Mission Control will build a live inbox from your authored
          and review-requested pull requests.
        </p>
        <div className="activation__promise">
          <span className="activation__promise-mark">
            <Icon name="check" size={14} strokeWidth={2.4} />
          </span>
          GitHub CLI manages your credentials. Mission Control does not install anything in your
          repositories.
        </div>
        <img
          className="activation__hero"
          src={onboardingHero}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
        />
      </section>

      <section className="activation-panel" aria-label="Activation progress">
        <div className="activation-panel__header">
          <div>
            <span className="activation-panel__step">Setup</span>
            <h2>Start with GitHub CLI</h2>
          </div>
          <span className="activation-panel__count">
            {[connected, repositoryAccess, repositoriesSelected, complete].filter(Boolean).length}
            /4
          </span>
        </div>

        <ol className="setup-list">
          <SetupStep
            number={1}
            title="Connect your GitHub CLI account"
            description={
              connected
                ? `Using the active account @${activation.githubLogin}`
                : githubCliAvailable
                  ? 'Sign in with gh auth login, then check again'
                  : 'Install GitHub CLI to continue'
            }
            state={connected ? 'complete' : 'current'}
          />
          <SetupStep
            number={2}
            title="Discover accessible repositories"
            description={
              repositoryAccess
                ? `${activation.accessibleRepositoryCount} repositories available`
                : 'Use the repositories visible to your active GitHub CLI account'
            }
            state={repositoryAccess ? 'complete' : connected ? 'current' : 'upcoming'}
          />
          <SetupStep
            number={3}
            title="Choose monitored repositories"
            description={
              repositoriesSelected
                ? `${repositories.filter((repository) => repository.monitored).length} monitored`
                : 'Keep the inbox focused on the repositories you choose'
            }
            state={repositoriesSelected ? 'complete' : repositoryAccess ? 'current' : 'upcoming'}
          />
          <SetupStep
            number={4}
            title="Build your attention inbox"
            description={
              complete
                ? 'Initial scan complete'
                : 'Find review requests, threads, and failing checks'
            }
            state={complete ? 'complete' : repositoriesSelected ? 'current' : 'upcoming'}
          />
        </ol>

        <div className="activation-action">
          {activation.step === 'github_cli_required' ? (
            <div className="activation-action__stack">
              <button
                className="button button--primary button--wide"
                type="button"
                onClick={() => onOpenUrl(githubCliUrl)}
              >
                Install GitHub CLI
                <Icon name="arrow-up-right" size={15} />
              </button>
              <button
                className="button button--quiet button--wide"
                type="button"
                onClick={onConnectAccount}
                disabled={busy}
              >
                {busy ? <span className="spinner spinner--dark" /> : <Icon name="sync" size={16} />}
                Check again
              </button>
            </div>
          ) : null}

          {activation.step === 'github_authorization_required' ? (
            <GithubCliSetup
              busy={busy}
              onCheck={onConnectAccount}
              onOpenHelp={() => onOpenUrl(githubCliAuthUrl)}
            />
          ) : null}

          {activation.step === 'repository_access_required' ? (
            <div className="activation-action__stack">
              <button
                className="button button--primary button--wide"
                type="button"
                onClick={onSynchronize}
                disabled={busy}
              >
                {busy ? <span className="spinner" /> : <Icon name="sync" size={16} />}
                {busy ? 'Checking repositories' : 'Refresh repository access'}
              </button>
              <button
                className="button button--quiet button--wide"
                type="button"
                onClick={onSwitchAccount}
                disabled={busy}
              >
                <Icon name="github" size={15} />
                Switch GitHub CLI account
              </button>
              <button
                className="button button--quiet button--wide"
                type="button"
                onClick={() => onOpenUrl(githubSsoUrl)}
              >
                Organization repository missing? Check SSO
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

          {activation.step === 'repository_selection_required' ? (
            <RepositorySelection
              repositories={repositories}
              busy={repositorySelectionBusy}
              error={repositorySelectionError}
              onComplete={onCompleteRepositorySelection}
              onRefresh={onSynchronize}
            />
          ) : null}

          {error ? <InlineError message={error} /> : null}
        </div>
      </section>
    </main>
  );
}

function GithubCliSetup({
  busy,
  onCheck,
  onOpenHelp,
}: {
  busy: boolean;
  onCheck(): void;
  onOpenHelp(): void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText('gh auth login');
    setCopied(true);
  };

  return (
    <div className="device-code">
      <div className="device-code__heading">
        <span>
          <Icon name="terminal" size={15} />
          Sign in through GitHub CLI
        </span>
      </div>
      <p>Run this once in Terminal. Return here when GitHub CLI confirms the account.</p>
      <div className="device-code__value">
        <code>gh auth login</code>
        <button
          className="icon-button"
          type="button"
          aria-label={copied ? 'GitHub CLI command copied' : 'Copy GitHub CLI command'}
          onClick={() => void copy()}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
      </div>
      <button
        className="button button--primary button--wide"
        type="button"
        onClick={onCheck}
        disabled={busy}
      >
        {busy ? <span className="spinner" /> : <Icon name="github" size={16} />}
        {busy ? 'Checking GitHub CLI' : 'Use active GitHub CLI account'}
      </button>
      <button className="button button--quiet button--wide" type="button" onClick={onOpenHelp}>
        GitHub CLI sign-in help
        <Icon name="arrow-up-right" size={15} />
      </button>
    </div>
  );
}

function RepositorySelection({
  repositories,
  busy,
  error,
  onComplete,
  onRefresh,
}: {
  repositories: LocalRepositoryAttachment[];
  busy: boolean;
  error: string | null;
  onComplete(repositoryIds: string[]): void;
  onRefresh(): void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredRepositories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return repositories;
    return repositories.filter((repository) =>
      repository.repository.toLocaleLowerCase().includes(normalized),
    );
  }, [query, repositories]);
  const selected = new Set(selectedIds);

  const toggle = (repositoryId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, repositoryId]))
        : current.filter((id) => id !== repositoryId),
    );
  };

  return (
    <div className="repository-picker">
      <div className="repository-picker__header">
        <label className="search-field">
          <span className="sr-only">Search accessible repositories</span>
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories"
          />
        </label>
        <span>{selectedIds.length} selected</span>
      </div>
      <div className="repository-picker__list" aria-label="Accessible repositories">
        {filteredRepositories.map((repository) => (
          <label className="repository-picker__row" key={repository.repositoryId}>
            <Checkbox
              checked={selected.has(repository.repositoryId)}
              disabled={busy}
              onCheckedChange={(checked) => toggle(repository.repositoryId, checked === true)}
            />
            <span>{repository.repository}</span>
          </label>
        ))}
        {filteredRepositories.length === 0 ? (
          <p className="repository-picker__empty">
            {repositories.length === 0
              ? 'Loading accessible repositories…'
              : 'No accessible repository matches that search.'}
          </p>
        ) : null}
      </div>
      <div className="repository-picker__bulk">
        <button
          type="button"
          onClick={() => setSelectedIds(repositories.map(({ repositoryId }) => repositoryId))}
        >
          Select all
        </button>
        <button type="button" onClick={() => setSelectedIds([])}>
          Clear
        </button>
      </div>
      <button
        className="button button--primary button--wide"
        type="button"
        disabled={busy || selectedIds.length === 0}
        onClick={() => onComplete(selectedIds)}
      >
        {busy ? <span className="spinner" /> : <Icon name="check" size={16} />}
        {busy ? 'Saving repositories' : 'Continue with selected repositories'}
      </button>
      <button className="button button--quiet button--wide" type="button" onClick={onRefresh}>
        Missing a repository? Refresh GitHub CLI access
        <Icon name="sync" size={15} />
      </button>
      {error ? <InlineError message={error} /> : null}
    </div>
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

function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
    </div>
  );
}
