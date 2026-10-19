import { SkillsPanel } from '../../SkillsPanel';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

/** Skills and agents of the active account (the existing dialog), shown while the tab is; closing it closes the tab. */
function SkillsTab({ api, tabId, visible }: PanelProps) {
  return <div className="agents-panel-skills">{visible && <SkillsPanel onClose={() => api.close(tabId)} />}</div>;
}

export const panel: PanelModule = {
  kind: 'skills',
  titleKey: 'panel.skills.title',
  icon: 'bookmark',
  placement: 'both',
  single: true,
  addMenu: 'tools',
  Panel: SkillsTab,
};
