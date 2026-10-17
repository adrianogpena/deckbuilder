import { type ReactNode, useState } from 'react';
import { t } from '../i18n';

export type SidePanelTab = 'changes' | 'notes' | 'trajectory';

const TAB_KEY = 'deckbuilder.agents.panelTab';
const TABS: SidePanelTab[] = ['changes', 'notes', 'trajectory'];

/** The remembered tab (`deckbuilder.agents.panelTab`), Changes by default. */
export const readPanelTab = (): SidePanelTab => {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'notes' || v === 'trajectory' ? v : 'changes';
  } catch {
    return 'changes';
  }
};

/** Remembers the active tab. */
export const writePanelTab = (tab: SidePanelTab) => {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* storage unavailable */
  }
};

export interface SidePanelProps {
  /** Content of the Changes tab; a placeholder when absent. */
  changes?: ReactNode;
  /** Content of the Notes tab; a placeholder when absent. */
  notes?: ReactNode;
  /** Content of the Trajectory tab; a placeholder when absent. */
  trajectory?: ReactNode;
  /** Active tab when controlled by the parent; else kept here. */
  tab?: SidePanelTab;
  onTabChange?: (tab: SidePanelTab) => void;
  onClose: () => void;
}

/** Right side panel of the Agents view: Changes / Notes / Trajectory tabs, the active one remembered. */
export function SidePanel({ changes, notes, trajectory, tab: controlled, onTabChange, onClose }: SidePanelProps) {
  const [own, setOwn] = useState(readPanelTab);
  const tab = controlled ?? own;
  const pick = (next: SidePanelTab) => {
    setOwn(next);
    writePanelTab(next);
    onTabChange?.(next);
  };
  const content = tab === 'changes' ? changes : tab === 'notes' ? notes : trajectory;

  return (
    <aside className={`agents-panel${tab === 'trajectory' ? ' agents-panel-wide' : ''}`} aria-label={t('agents.panel.label')}>
      <header className="agents-panel-head">
        <div className="agents-panel-tabs" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`agents-panel-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="agents-panel-body"
              onClick={() => pick(id)}
            >
              {t(`agents.panel.${id}`)}
            </button>
          ))}
        </div>
        <button type="button" className="agents-toggle" title={t('agents.panel.close')} aria-label={t('agents.panel.close')} onClick={onClose}>
          ×
        </button>
      </header>
      <div id="agents-panel-body" className="agents-panel-body" role="tabpanel" aria-labelledby={`agents-panel-tab-${tab}`}>
        {content ?? <p className="agents-empty agents-placeholder">{t(`agents.panel.${tab}.empty`)}</p>}
      </div>
    </aside>
  );
}
