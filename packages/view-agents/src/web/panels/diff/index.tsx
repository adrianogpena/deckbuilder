import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'diff',
  titleKey: 'panel.diff.title',
  icon: 'file',
  comingSoon: true,
  placement: 'center',
  Panel: () => (
    <div className="agents-panel-diff">
      <ComingSoon titleKey="panel.diff.title" icon="file" />
    </div>
  ),
};
