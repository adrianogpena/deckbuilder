import { ComingSoon } from '../../workspace/ComingSoon';
import type { PanelModule } from '../../workspace/types';
import './style.css';

export const panel: PanelModule = {
  kind: 'review',
  titleKey: 'panel.review.title',
  icon: 'eye',
  comingSoon: true,
  placement: 'both',
  addMenu: 'tools',
  Panel: () => (
    <div className="agents-panel-review">
      <ComingSoon titleKey="panel.review.title" icon="eye" />
    </div>
  ),
};
