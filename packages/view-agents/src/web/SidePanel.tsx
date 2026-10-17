import { type ReactNode, useState } from 'react';
import { t } from '../i18n';

export type SidePanelTab = 'changes' | 'notes';

const TAB_KEY = 'deckbuilder.agents.panelTab';
const TABS: SidePanelTab[] = ['changes', 'notes'];

const readTab = (): SidePanelTab => {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'notes' ? 'notes' : 'changes';
  } catch {
    return 'changes';
  }
};

export interface SidePanelProps {
  /** Content of the Changes tab; a placeholder when absent. */
  changes?: ReactNode;
  /** Content of the Notes tab; a placeholder when absent. */
  notes?: ReactNode;
  onClose: () => void;
}

/** Right side panel of the Agents view: Changes / Notes tabs, the active one remembered. */
export function SidePanel({ changes, notes, onClose }: SidePanelProps) {
  const [tab, setTab] = useState(readTab);
  const pick = (next: SidePanelTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const content = tab === 'changes' ? changes : notes;

  return (
    <aside className="agents-panel" aria-label={t('agents.panel.label')}>
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
