import { Icon } from './Icon';

export function AppRail() {
  return (
    <aside className="app-rail" aria-label="Mission Control navigation">
      <div className="app-mark" aria-label="Mission Control">
        <Icon name="branch" size={19} strokeWidth={2.1} />
      </div>
      <nav className="app-rail__nav" aria-label="Primary navigation">
        <button className="rail-button rail-button--active" type="button" aria-label="Reviews">
          <Icon name="inbox" size={18} />
          <span className="rail-button__label">Reviews</span>
        </button>
      </nav>
      <div className="app-rail__spacer" />
      <div className="rail-status" title="Background monitoring is active">
        <span className="rail-status__dot" />
        <span className="sr-only">Background monitoring active</span>
      </div>
    </aside>
  );
}
