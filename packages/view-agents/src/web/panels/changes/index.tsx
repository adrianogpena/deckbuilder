import { ChangesTab } from '../../ChangesTab';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

/** The project's changed files (the existing Changes tab); a change away from `running` of the selected session refreshes it. */
function ChangesPanel({ project }: PanelProps) {
  const host = useAgentsHost();
  const status = host.sessions.find((s) => s.id === host.selectedId)?.status;
  return (
    <div className="agents-panel-changes">
      <ChangesTab root={project} status={status} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'changes',
  titleKey: 'panel.changes.title',
  icon: 'git-branch',
  placement: 'both',
  addMenu: 'tools',
  Panel: ChangesPanel,
};
