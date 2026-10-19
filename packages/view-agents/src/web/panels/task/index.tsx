import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'task',
  titleKey: 'panel.task.title',
  icon: 'check',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-task">
      <ComingSoon titleKey="panel.task.title" icon="check" />
    </div>
  ),
};
