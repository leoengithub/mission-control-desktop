import { useMemo, useState } from 'react';
import type {
  AppSettings,
  AgentAvailability,
  CloseBehavior,
  LocalRepositoryAttachment,
  NotificationPermission,
  SettingsPatch,
  SyncPreset,
} from '../contracts';
import { Icon } from './Icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface SettingsWorkspaceProps {
  settings: AppSettings | null;
  notificationPermission: NotificationPermission;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  repositories: LocalRepositoryAttachment[];
  agents: AgentAvailability[];
  actionStates: Record<string, 'idle' | 'running' | 'error'>;
  actionErrors: Record<string, string>;
  githubLogin: string | null;
  accountBusy: boolean;
  onBack(): void;
  onSave(patch: SettingsPatch): void;
  onNotificationsEnabled(enabled: boolean): void;
  onAddLocalRepository(): void;
  onRefreshAgents(): void;
  onSetRepositoryMonitoring(repositoryIds: string[]): void;
  onOpenUrl(url: string): void;
  onSwitchAccount(): void;
  onDisconnectAccount(): void;
}

const authorizationSettingsUrl = 'https://github.com/settings/applications';

const syncOptions: Array<{
  value: SyncPreset;
  label: string;
  description: string;
}> = [
  { value: 'faster', label: 'Faster', description: '30 sec active · 2 min discovery' },
  { value: 'balanced', label: 'Balanced', description: '1 min active · 5 min discovery' },
  {
    value: 'battery_saver',
    label: 'Battery saver',
    description: '5 min active · 15 min discovery',
  },
];

const settingsNavLinkClass =
  'flex min-h-9 items-center gap-[9px] rounded-sm px-3 text-[0.8rem] font-[560] text-ink-secondary no-underline transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.99]';
const settingsSectionClass = 'scroll-mt-4 border-b border-hairline py-8 last:border-b-0';
const settingsHeadingClass = 'flex items-start gap-3';
const settingsIconClass =
  'grid size-8 shrink-0 place-items-center rounded-sm border border-hairline bg-surface text-ink-secondary';
const settingsHeadingTitleClass = 'm-0 text-base tracking-[-0.01em]';
const settingsHeadingCopyClass = 'mt-[3px] mb-0 max-w-[62ch] text-[0.8rem] text-ink-secondary';
const inlineErrorClass = 'm-0 flex items-start gap-1.5 text-[0.73rem] text-danger-deep';

export function SettingsWorkspace({
  settings,
  notificationPermission,
  saveState,
  error,
  repositories,
  agents,
  actionStates,
  actionErrors,
  githubLogin,
  accountBusy,
  onBack,
  onSave,
  onNotificationsEnabled,
  onAddLocalRepository,
  onRefreshAgents,
  onSetRepositoryMonitoring,
  onOpenUrl,
  onSwitchAccount,
  onDisconnectAccount,
}: SettingsWorkspaceProps) {
  const [repositoryQuery, setRepositoryQuery] = useState('');
  const filteredRepositories = useMemo(() => {
    const normalized = repositoryQuery.trim().toLocaleLowerCase();
    if (!normalized) return repositories;
    return repositories.filter((repository) =>
      repository.repository.toLocaleLowerCase().includes(normalized),
    );
  }, [repositories, repositoryQuery]);
  const automaticWorktreeDirectory = useMemo(
    () => resolveAutomaticWorktreeDirectory(repositories),
    [repositories],
  );

  if (!settings) {
    return (
      <main
        className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_oklch,var(--canvas)_88%,transparent)]"
        id="main-content"
      >
        <header
          className="flex min-h-14 items-center justify-between border-b border-hairline bg-surface pr-6 pl-[88px]"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-3">
            <button
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm bg-transparent text-ink-secondary transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.94]"
              type="button"
              aria-label="Back to reviews"
              onClick={onBack}
            >
              <Icon name="arrow-left" size={17} />
            </button>
            <div>
              <span className="hidden">Captain</span>
              <h1 className="m-0 text-base font-semibold tracking-[-0.015em]">Settings</h1>
            </div>
          </div>
        </header>
        <div className="mx-auto w-[min(640px,calc(100%-64px))] pt-12" aria-label="Loading settings">
          <span className="relative mb-3 block h-[30px] w-[45%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
          <span className="relative block h-[9px] w-[78%] overflow-hidden rounded-full bg-surface-muted after:block after:h-full after:w-full after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,oklch(100%_0_0/0.7),transparent)] after:content-['']" />
        </div>
      </main>
    );
  }

  const saving = saveState === 'saving';
  const updateNotificationReason = (
    key: 'reviewRequested' | 'unresolvedThread' | 'requiredChecksFailing',
    enabled: boolean,
  ) => {
    onSave({ notifications: { ...settings.notifications, [key]: enabled } });
  };

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_oklch,var(--canvas)_88%,transparent)]"
      id="main-content"
    >
      <header
        className="flex min-h-14 items-center justify-between border-b border-hairline bg-surface pr-6 pl-[88px]"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <button
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm bg-transparent text-ink-secondary transition-[background,color,transform] duration-state ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.94]"
            type="button"
            aria-label="Back to reviews"
            onClick={onBack}
          >
            <Icon name="arrow-left" size={17} />
          </button>
          <div>
            <span className="hidden">Captain</span>
            <h1 className="m-0 text-base font-semibold tracking-[-0.015em]">Settings</h1>
          </div>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1.5 text-[0.78rem] text-ink-secondary',
            saveState === 'saving' && '[&_svg]:animate-spin',
            saveState === 'saved' && 'text-success-deep',
            saveState === 'error' && 'text-danger-deep',
          )}
          aria-live="polite"
        >
          <Icon
            name={saveState === 'error' ? 'alert' : saveState === 'saving' ? 'sync' : 'check'}
            size={14}
          />
          <span>
            {saveState === 'saving'
              ? 'Saving'
              : saveState === 'saved'
                ? 'Saved locally'
                : saveState === 'error'
                  ? 'Could not save'
                  : 'Changes save automatically'}
          </span>
        </div>
      </header>

      {error ? (
        <div
          className="flex min-h-9 items-center gap-2 border-b border-danger/35 bg-danger-soft px-6 py-2 text-[0.8125rem] text-danger-deep"
          role="alert"
        >
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden max-[1120px]:grid-cols-[190px_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)]">
        <nav
          className="flex min-w-0 flex-col gap-0.5 border-r border-hairline bg-[color-mix(in_oklch,var(--info-soft)_42%,var(--surface))] px-4 py-6 max-[980px]:hidden"
          aria-label="Settings sections"
        >
          <span className="px-3 pb-2 text-[0.7rem] font-semibold tracking-[0.04em] text-ink-muted uppercase">
            Workspace
          </span>
          <a className={settingsNavLinkClass} href="#sync-settings">
            <Icon name="sync" size={15} />
            Synchronization
          </a>
          <a className={settingsNavLinkClass} href="#account-settings">
            <Icon name="github" size={15} />
            GitHub account
          </a>
          <a className={settingsNavLinkClass} href="#repository-settings">
            <Icon name="branch" size={15} />
            Repositories
          </a>
          <a className={settingsNavLinkClass} href="#notification-settings">
            <Icon name="alert" size={15} />
            Notifications
          </a>
          <span className="px-3 pt-6 pb-2 text-[0.7rem] font-semibold tracking-[0.04em] text-ink-muted uppercase">
            Tools
          </span>
          <a className={settingsNavLinkClass} href="#agent-settings">
            <Icon name="terminal" size={15} />
            Local agents
          </a>
          <a className={settingsNavLinkClass} href="#application-settings">
            <Icon name="settings" size={15} />
            Application
          </a>
        </nav>

        <div className="min-h-0 w-full max-w-[980px] overflow-auto px-12 pb-12 max-[1120px]:px-8 max-[980px]:mx-auto max-[980px]:max-w-[860px] max-[980px]:px-6">
          <section
            className={settingsSectionClass}
            id="sync-settings"
            aria-labelledby="sync-heading"
          >
            <div className={settingsHeadingClass}>
              <span className={settingsIconClass}>
                <Icon name="sync" size={17} />
              </span>
              <div>
                <h2 className={settingsHeadingTitleClass} id="sync-heading">
                  GitHub synchronization
                </h2>
                <p className={settingsHeadingCopyClass}>
                  Choose how quickly background monitoring should discover changes.
                </p>
              </div>
            </div>
            <div
              className="mt-4 grid grid-cols-3 gap-[3px] rounded-md border border-hairline bg-surface-muted p-[3px] max-[980px]:grid-cols-1"
              role="radiogroup"
              aria-label="Synchronization cadence"
            >
              {syncOptions.map((option) => (
                <button
                  className={cn(
                    'grid min-h-[66px] cursor-pointer grid-cols-[18px_minmax(0,1fr)] content-center items-center gap-x-2 gap-y-[3px] rounded-[8px] border border-transparent bg-transparent p-3 text-left transition-[border-color,background,transform] duration-state ease-out hover:border-hairline hover:bg-surface/60 active:scale-[0.99]',
                    settings.sync.preset === option.value &&
                      'border-hairline bg-surface shadow-[0_1px_3px_oklch(28%_0.01_128/0.1)]',
                  )}
                  type="button"
                  role="radio"
                  aria-checked={settings.sync.preset === option.value}
                  disabled={saving}
                  key={option.value}
                  onClick={() => onSave({ sync: { preset: option.value } })}
                >
                  <span
                    className={cn(
                      'grid size-[17px] place-items-center rounded-full border border-hairline-strong bg-surface text-success-deep',
                      settings.sync.preset === option.value && 'border-success',
                    )}
                  >
                    {settings.sync.preset === option.value ? <Icon name="check" size={13} /> : null}
                  </span>
                  <strong className="text-[0.8125rem]">{option.label}</strong>
                  <span className="col-start-2 text-[0.72rem] text-ink-secondary">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            className={settingsSectionClass}
            id="account-settings"
            aria-labelledby="github-account-heading"
          >
            <div className={settingsHeadingClass}>
              <span className={settingsIconClass}>
                <Icon name="github" size={17} />
              </span>
              <div>
                <h2 className={settingsHeadingTitleClass} id="github-account-heading">
                  GitHub account
                </h2>
                <p className={settingsHeadingCopyClass}>
                  Captain follows the active GitHub CLI account and never requires a repository
                  installation.
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-hairline bg-surface p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-selected text-success-deep"
                  aria-hidden="true"
                >
                  <Icon name="github" size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="text-sm">
                    {githubLogin ? `@${githubLogin}` : 'No GitHub account connected'}
                  </strong>
                  <small className="text-xs text-ink-secondary">
                    Credentials remain managed by GitHub CLI outside Captain.
                  </small>
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={accountBusy}
                  onClick={() => onOpenUrl(authorizationSettingsUrl)}
                >
                  Review GitHub CLI authorization
                  <Icon name="arrow-up-right" size={14} />
                </Button>
                <AccountActionDialog
                  action="switch"
                  busy={accountBusy}
                  onConfirm={onSwitchAccount}
                />
                <AccountActionDialog
                  action="disconnect"
                  busy={accountBusy}
                  onConfirm={onDisconnectAccount}
                />
              </div>
            </div>
          </section>

          <section
            className={settingsSectionClass}
            id="repository-settings"
            aria-labelledby="repositories-heading"
          >
            <div className={settingsHeadingClass}>
              <span className={settingsIconClass}>
                <Icon name="branch" size={17} />
              </span>
              <div>
                <h2 className={settingsHeadingTitleClass} id="repositories-heading">
                  Repositories
                </h2>
                <p className={settingsHeadingCopyClass}>
                  These are repositories visible to the active GitHub CLI account
                  {githubLogin ? ` @${githubLogin}` : ''}. Choose which appear in the inbox, then
                  optionally attach local Git roots for fix sessions.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 border-b border-hairline py-3 max-[720px]:items-stretch max-[720px]:flex-col">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-sm border border-hairline-strong bg-surface-raised px-3 text-ink-muted transition-[border-color,box-shadow] duration-state ease-out focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/12">
                <span className="sr-only">Search accessible repositories</span>
                <Icon name="search" size={15} />
                <input
                  data-composite-input
                  className="h-9 w-full min-w-0 border-0 bg-transparent p-0 text-[0.8125rem] text-ink outline-none placeholder:text-ink-secondary"
                  type="search"
                  value={repositoryQuery}
                  onChange={(event) => setRepositoryQuery(event.target.value)}
                  placeholder="Search repositories"
                />
              </label>
              <Button
                variant="outline"
                type="button"
                disabled={actionStates['add-local-repository'] === 'running'}
                onClick={onAddLocalRepository}
              >
                <Icon name="folder-plus" size={15} />
                {actionStates['add-local-repository'] === 'running'
                  ? 'Adding repository…'
                  : 'Add local repository'}
              </Button>
            </div>
            {actionErrors['add-local-repository'] ? (
              <p className={cn(inlineErrorClass, 'mt-3')} role="alert">
                <Icon name="alert" size={13} /> {actionErrors['add-local-repository']}
              </p>
            ) : null}
            {actionErrors['repository-monitoring'] ? (
              <p className={inlineErrorClass} role="alert">
                <Icon name="alert" size={13} /> {actionErrors['repository-monitoring']}
              </p>
            ) : null}
            <div className="flex flex-col">
              {filteredRepositories.length > 0 ? (
                filteredRepositories.map((repository) => (
                  <RepositorySetting
                    repository={repository}
                    monitoringBusy={actionStates['repository-monitoring'] === 'running'}
                    onMonitorChange={(checked) => {
                      const monitoredIds = repositories
                        .filter((candidate) =>
                          candidate.repositoryId === repository.repositoryId
                            ? checked
                            : candidate.monitored,
                        )
                        .map((candidate) => candidate.repositoryId);
                      onSetRepositoryMonitoring(monitoredIds);
                    }}
                    key={repository.repositoryId}
                  />
                ))
              ) : (
                <p className="m-0 py-4 text-ink-muted">
                  {repositories.length === 0
                    ? 'Repositories appear after GitHub access is synchronized.'
                    : 'No accessible repository matches that search.'}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-col border-t border-hairline">
              <label className="flex min-h-14 cursor-default items-center gap-3 border-b border-hairline py-2 last:border-b-0 max-[980px]:items-start">
                <span className="grid min-w-0 flex-1 gap-[3px]">
                  <strong className="text-sm">Worktree directory</strong>
                  <span className="text-[0.78rem] text-ink-secondary">
                    Leave empty to use a managed sibling directory beside each repository.
                  </span>
                </span>
                <Input
                  className="min-h-9 w-[min(46%,420px)] rounded-sm border-hairline-strong bg-surface-raised px-2.5 py-0 text-ink"
                  type="text"
                  defaultValue={settings.worktrees.baseDirectory ?? ''}
                  placeholder={automaticWorktreeDirectory}
                  disabled={saving}
                  onBlur={(event) =>
                    onSave({
                      worktrees: {
                        ...settings.worktrees,
                        baseDirectory: event.target.value.trim() || null,
                      },
                    })
                  }
                />
              </label>
              <label className="flex min-h-14 cursor-default items-center gap-3 border-b border-hairline py-2 last:border-b-0 max-[980px]:items-start">
                <span className="grid min-w-0 flex-1 gap-[3px]">
                  <strong className="text-sm">Cleanup policy</strong>
                  <span className="text-[0.78rem] text-ink-secondary">
                    Dirty worktrees and unique commits are always preserved.
                  </span>
                </span>
                <select
                  className="min-h-[34px] w-[min(46%,420px)] cursor-pointer rounded-sm border border-hairline-strong bg-surface-raised py-0 pr-[30px] pl-2.5 text-ink"
                  value={settings.worktrees.cleanupPolicy}
                  disabled={saving}
                  onChange={(event) =>
                    onSave({
                      worktrees: {
                        ...settings.worktrees,
                        cleanupPolicy: event.target
                          .value as AppSettings['worktrees']['cleanupPolicy'],
                      },
                    })
                  }
                >
                  <option value="safe_only">Remove unchanged worktrees</option>
                  <option value="always_preserve">Always preserve</option>
                  <option value="always_ask">Preserve for manual cleanup</option>
                </select>
              </label>
            </div>
          </section>

          <section
            className={settingsSectionClass}
            id="notification-settings"
            aria-labelledby="notifications-heading"
          >
            <SettingToggle
              icon="alert"
              headingId="notifications-heading"
              title="Native notifications"
              description="Alert only when a pull request newly escalates into an actionable state."
              checked={settings.notifications.enabled}
              disabled={saving}
              onChange={onNotificationsEnabled}
            />
            {notificationPermission === 'denied' ? (
              <p className="mt-2 mb-0 flex items-center gap-2 pl-11 text-[0.78rem] text-danger-deep">
                <Icon name="alert" size={14} />
                Notifications are blocked by the operating system. Re-enable them in system
                settings.
              </p>
            ) : null}
            <div className="grid gap-2 pt-4 pl-11" aria-label="Pull request notification reasons">
              <span className="mb-1 text-[0.72rem] font-semibold tracking-[0.04em] text-ink-muted uppercase">
                Notify me when
              </span>
              <ReasonCheckbox
                label="My review is requested"
                checked={settings.notifications.reviewRequested}
                disabled={!settings.notifications.enabled || saving}
                onChange={(checked) => updateNotificationReason('reviewRequested', checked)}
              />
              <ReasonCheckbox
                label="A review thread on my pull request is unresolved"
                checked={settings.notifications.unresolvedThread}
                disabled={!settings.notifications.enabled || saving}
                onChange={(checked) => updateNotificationReason('unresolvedThread', checked)}
              />
              <ReasonCheckbox
                label="Required checks on my pull request are failing"
                checked={settings.notifications.requiredChecksFailing}
                disabled={!settings.notifications.enabled || saving}
                onChange={(checked) => updateNotificationReason('requiredChecksFailing', checked)}
              />
            </div>
          </section>

          <section
            className={settingsSectionClass}
            id="agent-settings"
            aria-labelledby="agents-heading"
          >
            <div className={settingsHeadingClass}>
              <span className={settingsIconClass}>
                <Icon name="terminal" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className={settingsHeadingTitleClass} id="agents-heading">
                  Local agents
                </h2>
                <p className={settingsHeadingCopyClass}>
                  Select the default for review replies and isolated fix sessions.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={actionStates['agent-discovery'] === 'running'}
                onClick={onRefreshAgents}
              >
                <Icon name="refresh" size={14} />
                {actionStates['agent-discovery'] === 'running' ? 'Detecting…' : 'Refresh'}
              </Button>
            </div>
            {actionErrors['agent-discovery'] ? (
              <p className={cn(inlineErrorClass, 'mt-3 ml-11')} role="alert">
                <Icon name="alert" size={13} /> {actionErrors['agent-discovery']}
              </p>
            ) : null}
            <div
              className="ml-11 grid w-[calc(100%-44px)] grid-cols-2 gap-3 max-[980px]:grid-cols-1"
              role="radiogroup"
              aria-label="Default local agent"
            >
              {agents.map((agent) => (
                <button
                  className={cn(
                    'grid min-h-[70px] cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-hairline bg-surface p-3 text-left hover:border-hairline-strong hover:bg-surface-raised',
                    settings.agents.defaultAgent === agent.agent &&
                      'border-success/45 bg-success-soft',
                  )}
                  type="button"
                  role="radio"
                  aria-checked={settings.agents.defaultAgent === agent.agent}
                  disabled={!agent.available || saving}
                  key={agent.agent}
                  onClick={() =>
                    onSave({ agents: { ...settings.agents, defaultAgent: agent.agent } })
                  }
                >
                  <span
                    className={cn(
                      'grid size-[26px] place-items-center rounded-full border border-hairline-strong text-ink-secondary',
                      settings.agents.defaultAgent === agent.agent &&
                        'border-success text-success-deep',
                    )}
                  >
                    <Icon name={agent.available ? 'check' : 'alert'} size={14} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <strong>{agent.label}</strong>
                    <small className="text-[0.68rem] text-ink-muted">
                      {agentAvailabilityDetail(agent)}
                    </small>
                  </span>
                  <span className="text-[0.68rem] text-ink-muted">
                    {agentAvailabilityLabel(agent, settings.agents.defaultAgent === agent.agent)}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-2 pt-4 pl-11" aria-label="Agent permission behavior">
              <span className="mb-1 text-[0.72rem] font-semibold tracking-[0.04em] text-ink-muted uppercase">
                Interactive session permissions
              </span>
              <ReasonCheckbox
                label="Allow Codex to bypass its approval sandbox in fix sessions"
                checked={settings.agents.codexPermissionBypass}
                disabled={
                  saving || !agents.some((agent) => agent.agent === 'codex' && agent.available)
                }
                onChange={(codexPermissionBypass) =>
                  onSave({ agents: { ...settings.agents, codexPermissionBypass } })
                }
              />
              <ReasonCheckbox
                label="Allow Claude Code to bypass permission prompts in fix sessions"
                checked={settings.agents.claudePermissionBypass}
                disabled={
                  saving ||
                  !agents.some((agent) => agent.agent === 'claude_code' && agent.available)
                }
                onChange={(claudePermissionBypass) =>
                  onSave({ agents: { ...settings.agents, claudePermissionBypass } })
                }
              />
              {settings.agents.codexPermissionBypass || settings.agents.claudePermissionBypass ? (
                <p className="mt-2 mb-0 flex items-center gap-2 text-[0.78rem] text-danger-deep">
                  <Icon name="alert" size={14} />
                  Permission bypass applies only to interactive sessions and increases local risk.
                </p>
              ) : null}
            </div>
          </section>

          <section
            className={settingsSectionClass}
            id="application-settings"
            aria-labelledby="general-heading"
          >
            <div className={settingsHeadingClass}>
              <span className={settingsIconClass}>
                <Icon name="settings" size={17} />
              </span>
              <div>
                <h2 className={settingsHeadingTitleClass} id="general-heading">
                  Application behavior
                </h2>
                <p className={settingsHeadingCopyClass}>
                  Keep monitoring available without making Captain intrusive.
                </p>
              </div>
            </div>
            <div className="grid gap-2 pt-3 pl-11">
              <SettingToggle
                title="Launch at login"
                description="Start background monitoring when you sign in to this computer."
                checked={settings.general.launchAtLogin}
                disabled={saving}
                onChange={(launchAtLogin) =>
                  onSave({ general: { ...settings.general, launchAtLogin } })
                }
              />
              <div className="flex min-h-14 items-center gap-3 border-b border-hairline py-2 last:border-b-0 max-[980px]:items-start">
                <div className="grid min-w-0 flex-1 gap-[3px]">
                  <strong className="text-sm">When closing the window</strong>
                  <span className="text-[0.78rem] text-ink-secondary">
                    Choose whether Captain keeps monitoring in the menu bar.
                  </span>
                </div>
                <CloseBehaviorControl
                  value={settings.general.closeBehavior}
                  disabled={saving}
                  onChange={(closeBehavior) =>
                    onSave({ general: { ...settings.general, closeBehavior } })
                  }
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function resolveAutomaticWorktreeDirectory(repositories: LocalRepositoryAttachment[]): string {
  const localPath = repositories.find((repository) => repository.localPath)?.localPath;
  if (!localPath) return 'Attach a repository to resolve this path';

  const normalizedPath = localPath.replace(/[\\/]+$/, '');
  const parentBoundary = Math.max(
    normalizedPath.lastIndexOf('/'),
    normalizedPath.lastIndexOf('\\'),
  );
  const separator = normalizedPath.lastIndexOf('\\') > normalizedPath.lastIndexOf('/') ? '\\' : '/';
  const parentPath =
    parentBoundary === 0 ? separator : normalizedPath.slice(0, Math.max(parentBoundary, 0));

  return `${parentPath}${parentPath.endsWith(separator) ? '' : separator}.mission-control-worktrees`;
}

function agentAvailabilityDetail(agent: AgentAvailability): string {
  if (agent.source === 'preview_fixture') return agent.detail;
  if (agent.available) return agent.version || agent.detail;
  return agent.detail;
}

function agentAvailabilityLabel(agent: AgentAvailability, isDefault: boolean): string {
  if (isDefault) return 'Default';
  if (agent.source === 'preview_fixture') return 'Preview';
  if (agent.status === 'probe_failed') return 'Probe failed';
  return agent.available ? 'Available' : 'Not found';
}

function RepositorySetting({
  repository,
  monitoringBusy,
  onMonitorChange,
}: {
  repository: LocalRepositoryAttachment;
  monitoringBusy: boolean;
  onMonitorChange(checked: boolean): void;
}) {
  return (
    <div className="grid grid-cols-[minmax(190px,0.65fr)_auto_minmax(220px,1fr)] items-center gap-3 border-b border-hairline py-3 max-[980px]:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 items-center gap-3 max-[980px]:col-[1/-1]">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-deep',
            repository.validationState === 'valid' && 'bg-success-soft text-success-deep',
          )}
        >
          <Icon name={repository.validationState === 'valid' ? 'check' : 'alert'} size={14} />
        </span>
        <span className="flex min-w-0 flex-col">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap">
            {repository.repository}
          </strong>
          <small className="text-ink-muted">
            {repository.validationState === 'valid'
              ? 'Git remote verified'
              : 'Not attached to a local Git root'}
          </small>
        </span>
      </div>
      <label className="flex items-center gap-2 text-[0.72rem] text-ink-secondary max-[980px]:col-[1/-1]">
        <Switch
          checked={repository.monitored}
          disabled={monitoringBusy}
          onCheckedChange={onMonitorChange}
        />
        <span>{repository.monitored ? 'Monitored' : 'Hidden'}</span>
      </label>
      <span
        className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-ink-secondary max-[980px]:col-[1/-1]"
        title={repository.localPath ?? undefined}
      >
        {repository.localPath ?? 'Monitoring and review only'}
      </span>
    </div>
  );
}

function SettingToggle({
  icon,
  headingId,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon?: 'alert';
  headingId?: string;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 max-[980px]:items-start">
      {icon ? (
        <span className={settingsIconClass}>
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <div className="grid min-w-0 flex-1 gap-[3px]">
        <strong className="text-sm" id={headingId}>
          {title}
        </strong>
        <span className="text-[0.78rem] text-ink-secondary">{description}</span>
      </div>
      <span
        className={cn(
          'inline-flex min-w-[78px] items-center justify-end gap-2 text-xs font-semibold text-ink-secondary',
          checked && 'text-success-deep',
        )}
      >
        <Switch
          className="data-checked:bg-success-deep"
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
        <span>{checked ? 'On' : 'Off'}</span>
      </span>
    </div>
  );
}

function ReasonCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label
      className={cn(
        'flex w-fit cursor-pointer items-center gap-2 text-[0.8rem] text-ink-secondary has-[[data-slot=checkbox][data-checked]]:text-ink',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Checkbox
        className="data-checked:border-success data-checked:bg-success-deep data-checked:text-surface-raised"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

function AccountActionDialog({
  action,
  busy,
  onConfirm,
}: {
  action: 'switch' | 'disconnect';
  busy: boolean;
  onConfirm(): void;
}) {
  const switching = action === 'switch';
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant={switching ? 'secondary' : 'ghost'} size="sm" disabled={busy} />}
      >
        {switching ? 'Switch account' : 'Disconnect'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Icon name={switching ? 'refresh' : 'alert'} size={20} />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {switching ? 'Switch GitHub account?' : 'Disconnect this GitHub account?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {switching
              ? 'Captain will ask GitHub CLI to activate your other signed-in account. Add another account with `gh auth login` first if only one is available.'
              : 'Captain will stop using the active GitHub CLI account and clear the active inbox. Your GitHub CLI login remains available to Terminal and other tools.'}{' '}
            Local repositories, worktrees, and agent logs are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={switching ? 'text-[var(--primary-foreground)]' : undefined}
            variant={switching ? 'default' : 'destructive'}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : switching ? 'Switch account' : 'Disconnect'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CloseBehaviorControl({
  value,
  disabled,
  onChange,
}: {
  value: CloseBehavior;
  disabled: boolean;
  onChange(value: CloseBehavior): void;
}) {
  return (
    <div
      className="inline-flex rounded-sm border border-hairline bg-surface-muted p-[3px]"
      role="radiogroup"
      aria-label="Close behavior"
    >
      {[
        ['menu_bar', 'Keep monitoring'],
        ['quit', 'Quit app'],
      ].map(([option, label]) => (
        <button
          className={cn(
            'inline-flex min-h-[30px] cursor-pointer items-center gap-[5px] rounded-[5px] border-0 bg-transparent px-3 text-xs text-ink-secondary',
            value === option && 'bg-surface text-ink shadow-[0_1px_2px_oklch(24%_0.01_128/0.1)]',
          )}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          key={option}
          onClick={() => onChange(option as CloseBehavior)}
        >
          {value === option ? <Icon name="check" size={12} /> : null}
          {label}
        </button>
      ))}
    </div>
  );
}
