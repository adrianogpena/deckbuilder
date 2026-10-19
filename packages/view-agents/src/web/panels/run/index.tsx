import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'run',
  titleKey: 'panel.run.title',
  icon: 'play',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-run">
      <ComingSoon titleKey="panel.run.title" icon="play" />
    </div>
  ),
};
