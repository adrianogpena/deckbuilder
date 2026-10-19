import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'code',
  titleKey: 'panel.code.title',
  icon: 'code',
  comingSoon: true,
  placement: 'center',
  Panel: () => (
    <div className="agents-panel-code">
      <ComingSoon titleKey="panel.code.title" icon="code" />
    </div>
  ),
};
