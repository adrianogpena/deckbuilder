import { NotesTab } from '../../NotesTab';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

/** The project's notes (the existing Notes tab); Send goes to the selected session. */
function NotesPanel({ project, api }: PanelProps) {
  const host = useAgentsHost();
  const target = host.selectedId;
  return (
    <div className="agents-panel-notes">
      <NotesTab project={host.projectIdOf(project)} canSend={target !== undefined} onSend={(text) => target && api.sendToSession(target, text)} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'notes',
  titleKey: 'panel.notes.title',
  icon: 'markdown',
  placement: 'both',
  addMenu: 'tools',
  Panel: NotesPanel,
};
