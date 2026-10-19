import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'json',
  titleKey: 'panel.json.title',
  icon: 'braces',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-json">
      <ComingSoon titleKey="panel.json.title" icon="braces" />
    </div>
  ),
};
