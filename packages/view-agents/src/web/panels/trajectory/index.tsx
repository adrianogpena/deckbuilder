import { TrajectoryTab } from '../../TrajectoryTab';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

/** The steps of a session (the existing Trajectory tab): the one in `params.sessionId`, else the selected session. */
function TrajectoryPanel({ params, api, tabId }: PanelProps) {
  const host = useAgentsHost();
  const sessionId = typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : host.selectedId;
  const session = host.sessions.find((s) => s.id === sessionId);
  return (
    <div className="agents-panel-trajectory">
      <TrajectoryTab sessionId={session?.id} available={!!session && session.lifecycle !== 'starting'} onClose={() => api.close(tabId)} />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'trajectory',
  titleKey: 'panel.trajectory.title',
  icon: 'history',
  placement: 'both',
  Panel: TrajectoryPanel,
};
