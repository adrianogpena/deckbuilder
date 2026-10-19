import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'files',
  titleKey: 'panel.files.title',
  icon: 'folder',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-files">
      <ComingSoon titleKey="panel.files.title" icon="folder" />
    </div>
  ),
};
