import { Badge, PanelBanner, PanelNotice, Icon, type GridItem } from '@deckbuilderkit/ui';
import { definePanel } from '@deckbuilderkit/view-grid/web';
import type { UpdateState } from '@deckbuilderkit/server-core/protocol';
import { api, type Info } from '../api';
import { t } from '../i18n';

const infoPanel = definePanel<Record<string, never>, Info>({
  kind: 'info',
  title: 'grid.panel.info',
  description: 'grid.panel.info.description',
  icon: 'home',
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  allowMultiple: false,
  load: () => api.info(),
  render: ({ data }) => {
    const rows: Array<[string, string]> = [
      [t('home.version'), data.version],
      [t('home.platform'), `${data.platform} / ${data.arch}`],
      [t('home.host'), data.hostname],
      [t('home.runtime'), `bun ${data.bun}`],
    ];
    return (
      <div className="facts">
        {rows.map(([label, value]) => (
          <div key={label} className="fact">
            <div className="fact-label">{label}</div>
            <div className="fact-value mono">{value}</div>
          </div>
        ))}
      </div>
    );
  },
});

const updatePanel = definePanel<Record<string, never>, UpdateState>({
  kind: 'update',
  title: 'grid.panel.update',
  description: 'grid.panel.update.description',
  icon: 'send',
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  allowMultiple: false,
  load: () => api.update(),
  refreshMs: 60_000,
  render: ({ data: u }) => {
    if (u.status === 'not-configured') {
      return <PanelNotice icon={<Icon name="send" size={20} />} title={t('settings.update.notConfigured')} />;
    }
    return (
      <>
        {u.status === 'offline' && <PanelBanner tone="warn">{t('settings.update.offline')}</PanelBanner>}
        {u.status === 'error' && <PanelBanner tone="err">{u.message ?? t('grid.loadFailed')}</PanelBanner>}
        <p className="small">{t('settings.update.current', { version: u.current })}</p>
        <p>
          {u.available
            ? <Badge tone="info">{t('settings.update.available', { version: u.version ?? '' })}</Badge>
            : <Badge tone="ok">{t('settings.update.latest')}</Badge>}
        </p>
      </>
    );
  },
});

const LIST_ITEMS = ['grid.list.drag', 'grid.list.resize', 'grid.list.collapse', 'grid.list.remove'] as const;

const listPanel = definePanel({
  kind: 'list',
  title: 'grid.panel.list',
  description: 'grid.panel.list.description',
  icon: 'copy',
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  allowMultiple: false,
  render: () => (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {LIST_ITEMS.map((key) => <li key={key}>{t(key)}</li>)}
    </ul>
  ),
});

export { infoPanel, listPanel, updatePanel };

export const DEFAULT_GRID: GridItem[] = [
  { id: 'clock', kind: 'clock', config: { timeZone: '', hour12: false, showSeconds: true, showDate: true }, x: 0, y: 0, w: 6, h: 8 },
  { id: 'info', kind: 'info', x: 6, y: 0, w: 6, h: 8 },
  { id: 'update', kind: 'update', x: 0, y: 8, w: 6, h: 8 },
  { id: 'list', kind: 'list', x: 6, y: 8, w: 6, h: 8 },
];
