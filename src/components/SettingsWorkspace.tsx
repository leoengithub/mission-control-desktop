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

interface SettingsWorkspaceProps {
  settings: AppSettings | null;
  notificationPermission: NotificationPermission;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  repositories: LocalRepositoryAttachment[];
  agents: AgentAvailability[];
  actionStates: Record<string, 'idle' | 'running' | 'error'>;
  actionErrors: Record<string, string>;
  onSave(patch: SettingsPatch): void;
  onNotificationsEnabled(enabled: boolean): void;
  onAttachRepository(repositoryId: string, localPath: string): void;
}

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

export function SettingsWorkspace({
  settings,
  notificationPermission,
  saveState,
  error,
  repositories,
  agents,
  actionStates,
  actionErrors,
  onSave,
  onNotificationsEnabled,
  onAttachRepository,
}: SettingsWorkspaceProps) {
  if (!settings) {
    return (
      <main className="workspace settings-workspace" id="main-content">
        <header className="workspace-header">
          <div>
            <span className="workspace-header__context">Mission Control</span>
            <h1>Settings</h1>
          </div>
        </header>
        <div className="settings-loading" aria-label="Loading settings">
          <span className="skeleton skeleton--heading" />
          <span className="skeleton skeleton--title" />
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
    <main className="workspace settings-workspace" id="main-content">
      <header className="workspace-header">
        <div>
          <span className="workspace-header__context">Mission Control</span>
          <h1>Settings</h1>
        </div>
        <div className={`settings-save-state settings-save-state--${saveState}`} aria-live="polite">
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
        <div className="sync-error" role="alert">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="settings-content">
        <section className="settings-section" aria-labelledby="sync-heading">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <Icon name="sync" size={17} />
            </span>
            <div>
              <h2 id="sync-heading">GitHub synchronization</h2>
              <p>Choose how quickly background monitoring should discover changes.</p>
            </div>
          </div>
          <div className="choice-grid" role="radiogroup" aria-label="Synchronization cadence">
            {syncOptions.map((option) => (
              <button
                className={`choice-button${
                  settings.sync.preset === option.value ? ' choice-button--selected' : ''
                }`}
                type="button"
                role="radio"
                aria-checked={settings.sync.preset === option.value}
                disabled={saving}
                key={option.value}
                onClick={() => onSave({ sync: { preset: option.value } })}
              >
                <span className="choice-button__mark">
                  {settings.sync.preset === option.value ? <Icon name="check" size={13} /> : null}
                </span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="notifications-heading">
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
            <p className="settings-inline-warning">
              <Icon name="alert" size={14} />
              Notifications are blocked by the operating system. Re-enable them in system settings.
            </p>
          ) : null}
          <div className="settings-subsection" aria-label="Pull request notification reasons">
            <span className="settings-subsection__label">Notify me when</span>
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

        <section className="settings-section" aria-labelledby="repositories-heading">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <Icon name="branch" size={17} />
            </span>
            <div>
              <h2 id="repositories-heading">Local repositories</h2>
              <p>Attach the matching Git root before starting fix sessions or local terminals.</p>
            </div>
          </div>
          <div className="repository-settings-list">
            {repositories.length > 0 ? (
              repositories.map((repository) => (
                <RepositorySetting
                  repository={repository}
                  busy={actionStates[`repository:${repository.repositoryId}`] === 'running'}
                  error={actionErrors[`repository:${repository.repositoryId}`] ?? null}
                  onAttach={onAttachRepository}
                  key={repository.repositoryId}
                />
              ))
            ) : (
              <p className="settings-empty-copy">
                Repositories appear after the first successful GitHub synchronization.
              </p>
            )}
          </div>
          <div className="settings-rows settings-rows--compact">
            <label className="setting-row setting-row--field">
              <span className="setting-row__copy">
                <strong>Worktree directory</strong>
                <span>Leave empty to use a managed sibling directory beside each repository.</span>
              </span>
              <input
                className="settings-text-input"
                type="text"
                defaultValue={settings.worktrees.baseDirectory ?? ''}
                placeholder="Automatic"
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
            <label className="setting-row setting-row--field">
              <span className="setting-row__copy">
                <strong>Cleanup policy</strong>
                <span>Dirty worktrees and unique commits are always preserved.</span>
              </span>
              <select
                className="settings-select"
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

        <section className="settings-section" aria-labelledby="agents-heading">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <Icon name="terminal" size={17} />
            </span>
            <div>
              <h2 id="agents-heading">Local agents</h2>
              <p>Select the default for review replies and isolated fix sessions.</p>
            </div>
          </div>
          <div className="agent-settings-grid" role="radiogroup" aria-label="Default local agent">
            {agents.map((agent) => (
              <button
                className={`agent-setting${
                  settings.agents.defaultAgent === agent.agent ? ' agent-setting--selected' : ''
                }`}
                type="button"
                role="radio"
                aria-checked={settings.agents.defaultAgent === agent.agent}
                disabled={!agent.available || saving}
                key={agent.agent}
                onClick={() =>
                  onSave({ agents: { ...settings.agents, defaultAgent: agent.agent } })
                }
              >
                <span className="agent-setting__mark">
                  <Icon name={agent.available ? 'check' : 'alert'} size={14} />
                </span>
                <span>
                  <strong>{agent.label}</strong>
                  <small>{agent.available ? agent.version || 'Installed' : 'Not detected'}</small>
                </span>
                <span>
                  {settings.agents.defaultAgent === agent.agent ? 'Default' : 'Available'}
                </span>
              </button>
            ))}
          </div>
          <div className="settings-subsection" aria-label="Agent permission behavior">
            <span className="settings-subsection__label">Interactive session permissions</span>
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
                saving || !agents.some((agent) => agent.agent === 'claude_code' && agent.available)
              }
              onChange={(claudePermissionBypass) =>
                onSave({ agents: { ...settings.agents, claudePermissionBypass } })
              }
            />
            {settings.agents.codexPermissionBypass || settings.agents.claudePermissionBypass ? (
              <p className="settings-inline-warning">
                <Icon name="alert" size={14} />
                Permission bypass applies only to interactive sessions and increases local risk.
              </p>
            ) : null}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="general-heading">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <Icon name="settings" size={17} />
            </span>
            <div>
              <h2 id="general-heading">Application behavior</h2>
              <p>Keep monitoring available without making Mission Control intrusive.</p>
            </div>
          </div>
          <div className="settings-rows">
            <SettingToggle
              title="Launch at login"
              description="Start background monitoring when you sign in to this computer."
              checked={settings.general.launchAtLogin}
              disabled={saving}
              onChange={(launchAtLogin) =>
                onSave({ general: { ...settings.general, launchAtLogin } })
              }
            />
            <div className="setting-row">
              <div className="setting-row__copy">
                <strong>When closing the window</strong>
                <span>Choose whether Mission Control keeps monitoring in the menu bar.</span>
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
    </main>
  );
}

function RepositorySetting({
  repository,
  busy,
  error,
  onAttach,
}: {
  repository: LocalRepositoryAttachment;
  busy: boolean;
  error: string | null;
  onAttach(repositoryId: string, localPath: string): void;
}) {
  return (
    <form
      className="repository-setting"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const localPath = String(form.get('localPath') ?? '').trim();
        if (localPath) onAttach(repository.repositoryId, localPath);
      }}
    >
      <div className="repository-setting__identity">
        <span
          className={
            repository.validationState === 'valid'
              ? 'repository-setting__mark repository-setting__mark--valid'
              : 'repository-setting__mark'
          }
        >
          <Icon name={repository.validationState === 'valid' ? 'check' : 'alert'} size={14} />
        </span>
        <span>
          <strong>{repository.repository}</strong>
          <small>
            {repository.validationState === 'valid'
              ? 'Git remote verified'
              : 'Not attached to a local Git root'}
          </small>
        </span>
      </div>
      <input
        className="settings-text-input repository-setting__input"
        type="text"
        name="localPath"
        defaultValue={repository.localPath ?? ''}
        aria-label={`Local path for ${repository.repository}`}
        placeholder="/Users/you/Work/repository"
        disabled={busy}
      />
      <button className="button button--quiet" type="submit" disabled={busy}>
        {busy ? 'Validating…' : repository.localPath ? 'Revalidate' : 'Attach'}
      </button>
      {error ? (
        <p className="repository-setting__error" role="alert">
          <Icon name="alert" size={13} /> {error}
        </p>
      ) : null}
    </form>
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
    <div className="setting-row">
      {icon ? (
        <span className="settings-section__icon">
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <div className="setting-row__copy">
        <strong id={headingId}>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        className={`switch-control${checked ? ' switch-control--checked' : ''}`}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-control__track">
          <span className="switch-control__thumb" />
        </span>
        <span>{checked ? 'On' : 'Off'}</span>
      </button>
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
    <label className={`reason-checkbox${disabled ? ' reason-checkbox--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="reason-checkbox__mark">
        {checked ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
      </span>
      <span>{label}</span>
    </label>
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
    <div className="segmented-control" role="radiogroup" aria-label="Close behavior">
      {[
        ['menu_bar', 'Keep monitoring'],
        ['quit', 'Quit app'],
      ].map(([option, label]) => (
        <button
          className={value === option ? 'segmented-control__active' : undefined}
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
