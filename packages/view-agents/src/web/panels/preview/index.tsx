import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'preview',
  titleKey: 'panel.preview.title',
  icon: 'preview',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-preview">
      <ComingSoon titleKey="panel.preview.title" icon="preview" />
    </div>
  ),
};
