import { usageViewData } from '../../UsageView';
import { UsageTab } from '../../UsageTab';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

/** Plan usage per account (the existing dialog), shown while the tab is; closing it closes the tab. */
function UsagePanel({ api, tabId, visible }: PanelProps) {
  const host = useAgentsHost();
  const selected = host.sessions.find((s) => s.id === host.selectedId);
  return (
    <div className="agents-panel-usage">
      {visible && (
        <UsageTab
          usage={host.usage}
          sessions={host.sessions}
          activeAccount={usageViewData(selected, host.usage, []).usage?.account}
          use24h={host.usageSettings?.use24h}
          onClose={() => api.close(tabId)}
        />
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'usage',
  titleKey: 'panel.usage.title',
  icon: 'database',
  placement: 'both',
  single: true,
  addMenu: 'tools',
  Panel: UsagePanel,
};
