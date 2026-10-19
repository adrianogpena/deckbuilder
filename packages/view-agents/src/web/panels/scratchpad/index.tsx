import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'scratchpad',
  titleKey: 'panel.scratchpad.title',
  icon: 'edit',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-scratchpad">
      <ComingSoon titleKey="panel.scratchpad.title" icon="edit" />
    </div>
  ),
};
