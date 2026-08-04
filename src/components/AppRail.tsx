import { Icon } from './Icon';

export type AppView = 'reviews' | 'settings';

export function AppRail({
  activeView,
  attentionCount,
  monitoringActive,
  onNavigate,
}: {
  activeView: AppView;
  attentionCount: number;
  monitoringActive: boolean;
  onNavigate(view: AppView): void;
}) {
  return (
    <aside className="app-rail" aria-label="Mission Control navigation">
      <div className="app-mark" aria-label="Mission Control">
        <Icon name="branch" size={19} strokeWidth={2.1} />
      </div>
      <nav className="app-rail__nav" aria-label="Primary navigation">
        <button
          className={`rail-button${activeView === 'reviews' ? ' rail-button--active' : ''}`}
          type="button"
          aria-label={attentionCount > 0 ? `Reviews, ${attentionCount} need attention` : 'Reviews'}
          aria-current={activeView === 'reviews' ? 'page' : undefined}
          onClick={() => onNavigate('reviews')}
        >
          <Icon name="inbox" size={18} />
          {attentionCount > 0 ? (
            <span className="rail-button__badge" aria-hidden="true">
              {attentionCount > 9 ? '9+' : attentionCount}
            </span>
          ) : null}
          <span className="rail-button__label">Reviews</span>
        </button>
        <button
          className={`rail-button${activeView === 'settings' ? ' rail-button--active' : ''}`}
          type="button"
          aria-label="Settings"
          aria-current={activeView === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Icon name="settings" size={18} />
          <span className="rail-button__label">Settings</span>
        </button>
      </nav>
      <div className="app-rail__spacer" />
      <div
        className={`rail-status${monitoringActive ? ' rail-status--active' : ''}`}
        title={monitoringActive ? 'Background monitoring is active' : 'Monitoring is not active'}
      >
        <span className="rail-status__dot" aria-hidden="true" />
        <span className="sr-only">
          {monitoringActive ? 'Background monitoring active' : 'Background monitoring inactive'}
        </span>
      </div>
    </aside>
  );
}
