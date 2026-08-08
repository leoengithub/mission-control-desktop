import { useMemo, useState } from 'react';
import type { ActivationState, LocalRepositoryAttachment } from '../contracts';
import { Icon } from './Icon';
import onboardingHero from '../../assets/brand/raster/onboarding-hero.png';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

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
    <main
      className="grid min-w-0 flex-1 grid-cols-[minmax(360px,1fr)_minmax(420px,520px)] items-center gap-[clamp(48px,8vw,112px)] bg-canvas px-[clamp(48px,7vw,120px)] py-[clamp(48px,8vh,96px)] max-[1120px]:gap-12 max-[1120px]:px-12 max-[980px]:grid-cols-[minmax(300px,0.8fr)_minmax(400px,1fr)] max-[980px]:gap-8 max-[980px]:px-8 max-[980px]:py-12"
      id="main-content"
      data-tauri-drag-region
    >
      <section className="max-w-[620px]" aria-labelledby="activation-title">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] text-success-deep uppercase">
          <Icon name="spark" size={15} />
          First run
        </div>
        <h1
          className="my-4 max-w-[11ch] text-[clamp(2.5rem,5vw,4.6rem)] leading-[0.98] font-semibold tracking-[-0.055em] text-balance max-[980px]:text-[2.8rem]"
          id="activation-title"
        >
          See what needs you.
        </h1>
        <p className="m-0 max-w-[54ch] text-base leading-[1.65] text-ink-secondary">
          Use your GitHub CLI account and Mission Control will build a live inbox from your authored
          and review-requested pull requests.
        </p>
        <div className="mt-8 flex max-w-[52ch] items-center gap-2 text-[0.8125rem] text-ink-secondary">
          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-success-soft text-success-deep">
            <Icon name="check" size={14} strokeWidth={2.4} />
          </span>
          GitHub CLI manages your credentials. Mission Control does not install anything in your
          repositories.
        </div>
        <img
          className="mt-8 block max-h-[210px] w-[min(100%,520px)] rounded-lg border border-hairline object-cover object-[center_46%]"
          src={onboardingHero}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
        />
      </section>

      <section
        className="self-center overflow-hidden rounded-lg border border-hairline bg-surface"
        aria-label="Activation progress"
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase">
              Setup
            </span>
            <h2 className="mt-[3px] text-xl tracking-[-0.02em]">Start with GitHub CLI</h2>
          </div>
          <span className="text-ink-secondary [font-variant-numeric:tabular-nums]">
            {[connected, repositoryAccess, repositoriesSelected, complete].filter(Boolean).length}
            /4
          </span>
        </div>

        <ol className="m-0 list-none p-0">
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

        <div className="border-t border-hairline bg-surface-muted p-6">
          {activation.step === 'github_cli_required' ? (
            <div className="grid gap-2">
              <Button className="w-full" type="button" onClick={() => onOpenUrl(githubCliUrl)}>
                Install GitHub CLI
                <Icon name="arrow-up-right" size={15} />
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                onClick={onConnectAccount}
                disabled={busy}
              >
                {busy ? <Spinner dark /> : <Icon name="sync" size={16} />}
                Check again
              </Button>
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
            <div className="grid gap-2">
              <Button className="w-full" type="button" onClick={onSynchronize} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="sync" size={16} />}
                {busy ? 'Checking repositories' : 'Refresh repository access'}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                onClick={onSwitchAccount}
                disabled={busy}
              >
                <Icon name="github" size={15} />
                Switch GitHub CLI account
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                onClick={() => onOpenUrl(githubSsoUrl)}
              >
                Organization repository missing? Check SSO
                <Icon name="arrow-up-right" size={15} />
              </Button>
            </div>
          ) : null}

          {activation.step === 'initial_sync_required' ? (
            <Button className="w-full" type="button" onClick={onSynchronize} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="sync" size={16} />}
              {busy ? 'Scanning pull requests' : 'Build attention inbox'}
            </Button>
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
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-[0.8125rem] font-semibold text-warning-deep">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="terminal" size={15} />
          Sign in through GitHub CLI
        </span>
      </div>
      <p className="m-0 text-[0.8125rem] text-ink-secondary">
        Run this once in Terminal. Return here when GitHub CLI confirms the account.
      </p>
      <div className="flex items-center justify-between rounded-md border border-hairline-strong bg-surface py-2 pr-2 pl-4">
        <code className="font-mono text-[1.1rem] font-bold tracking-[0.12em] [font-variant-ligatures:none]">
          gh auth login
        </code>
        <button
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm bg-transparent text-ink-secondary transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.94]"
          type="button"
          aria-label={copied ? 'GitHub CLI command copied' : 'Copy GitHub CLI command'}
          onClick={() => void copy()}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
        </button>
      </div>
      <Button className="w-full" type="button" onClick={onCheck} disabled={busy}>
        {busy ? <Spinner /> : <Icon name="github" size={16} />}
        {busy ? 'Checking GitHub CLI' : 'Use active GitHub CLI account'}
      </Button>
      <Button className="w-full" variant="outline" type="button" onClick={onOpenHelp}>
        GitHub CLI sign-in help
        <Icon name="arrow-up-right" size={15} />
      </Button>
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
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border border-hairline-strong bg-surface-raised px-3 text-ink-muted transition-[border-color,box-shadow] duration-state ease-out focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/10">
          <span className="sr-only">Search accessible repositories</span>
          <Icon name="search" size={15} />
          <input
            className="h-9 w-full min-w-0 border-0 bg-transparent p-0 text-[0.8125rem] text-ink outline-none placeholder:text-ink-secondary"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories"
          />
        </label>
        <span className="shrink-0 text-[0.72rem] text-ink-muted [font-variant-numeric:tabular-nums]">
          {selectedIds.length} selected
        </span>
      </div>
      <div
        className="max-h-[210px] overflow-auto rounded-md border border-hairline bg-surface"
        aria-label="Accessible repositories"
      >
        {filteredRepositories.map((repository) => (
          <label
            className="flex min-h-10 cursor-pointer items-center gap-3 border-b border-hairline px-3 last:border-b-0 hover:bg-surface-muted"
            key={repository.repositoryId}
          >
            <Checkbox
              checked={selected.has(repository.repositoryId)}
              disabled={busy}
              onCheckedChange={(checked) => toggle(repository.repositoryId, checked === true)}
            />
            <span className="overflow-hidden text-[0.8rem] font-[560] text-ellipsis whitespace-nowrap">
              {repository.repository}
            </span>
          </label>
        ))}
        {filteredRepositories.length === 0 ? (
          <p className="m-0 p-4 text-[0.78rem] text-ink-muted">
            {repositories.length === 0
              ? 'Loading accessible repositories…'
              : 'No accessible repository matches that search.'}
          </p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <button
          className="cursor-pointer border-0 border-b border-current bg-transparent p-0 text-[0.72rem] font-semibold text-ink-secondary"
          type="button"
          onClick={() => setSelectedIds(repositories.map(({ repositoryId }) => repositoryId))}
        >
          Select all
        </button>
        <button
          className="cursor-pointer border-0 border-b border-current bg-transparent p-0 text-[0.72rem] font-semibold text-ink-secondary"
          type="button"
          onClick={() => setSelectedIds([])}
        >
          Clear
        </button>
      </div>
      <Button
        className="w-full"
        type="button"
        disabled={busy || selectedIds.length === 0}
        onClick={() => onComplete(selectedIds)}
      >
        {busy ? <Spinner /> : <Icon name="check" size={16} />}
        {busy ? 'Saving repositories' : 'Continue with selected repositories'}
      </Button>
      <Button className="w-full" variant="outline" type="button" onClick={onRefresh}>
        Missing a repository? Refresh GitHub CLI access
        <Icon name="sync" size={15} />
      </Button>
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
    <li className={setupStepVariants({ state })}>
      <span className={setupStepMarkVariants({ state })} aria-hidden="true">
        {state === 'complete' ? <Icon name="check" size={14} strokeWidth={2.5} /> : number}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="text-sm font-semibold">{title}</strong>
        <span className="text-[0.78rem] leading-[1.35] text-ink-secondary">{description}</span>
      </span>
      <span
        className={cn(
          'text-xs',
          state === 'current'
            ? 'text-warning-deep'
            : state === 'complete'
              ? 'text-success-deep'
              : 'text-ink-muted',
        )}
      >
        {state === 'complete' ? 'Done' : state === 'current' ? 'Current' : 'Later'}
      </span>
    </li>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-sm border border-danger/35 bg-danger-soft p-3 text-[0.8125rem] text-danger-deep"
      role="alert"
    >
      <Icon name="alert" size={16} />
      <span>{message}</span>
    </div>
  );
}

const setupStepVariants = cva(
  'grid min-h-[68px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline px-6 py-3',
  {
    variants: { state: { complete: '', current: '', upcoming: 'text-ink-muted' } },
  },
);

const setupStepMarkVariants = cva(
  'grid size-6 place-items-center rounded-full border border-hairline-strong text-xs text-ink-secondary [font-variant-numeric:tabular-nums]',
  {
    variants: {
      state: {
        complete: 'border-success bg-success text-surface',
        current: 'border-warning bg-warning-soft text-warning-deep',
        upcoming: '',
      },
    },
  },
);

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={cn(
        'size-3.5 animate-spin rounded-full border-2',
        dark ? 'border-hairline-strong border-t-ink' : 'border-surface/35 border-t-surface',
      )}
    />
  );
}
