import { useEffect, useState, type ReactNode } from 'react';
import {
  addItem,
  Badge,
  errorMessage,
  Icon,
  type IconName,
  PageHead,
  PanelBanner,
  PanelGrid,
  PanelLoading,
  PanelNotice,
  sameItems,
  useAsync,
  validGridItems,
  type GridItem,
  type PanelDef,
} from '@deckbuilderkit/ui';
import { api, type Settings } from '../api';
import { t } from '../i18n';

const PANEL_IDS = ['clock', 'info', 'update', 'list'] as const;
type PanelId = (typeof PANEL_IDS)[number];

const def = (id: PanelId, icon: IconName): PanelDef => ({
  id,
  title: t(`grid.panel.${id}`),
  icon,
  defaultSize: { w: 6, h: 8 },
  minW: 3,
  minH: 4,
});

const defs = (): PanelDef[] => [def('clock', 'refresh'), def('info', 'home'), def('update', 'send'), def('list', 'copy')];

const DEFAULT_ITEMS: GridItem[] = [
  { id: 'clock', x: 0, y: 0, w: 6, h: 8 },
  { id: 'info', x: 6, y: 0, w: 6, h: 8 },
  { id: 'update', x: 0, y: 8, w: 6, h: 8 },
  { id: 'list', x: 6, y: 8, w: 6, h: 8 },
];

/** The saved layout, or the default one when nothing valid was saved. */
function restoreItems(raw: unknown): GridItem[] {
  return validGridItems(raw, PANEL_IDS) ?? DEFAULT_ITEMS;
}

/** Unsaved layout, kept while another screen is shown; a restart drops it. */
let unsaved: GridItem[] | null = null;

export function GridScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [saved, setSaved] = useState(() => restoreItems(settings.gridLayout));
  const [items, setItems] = useState(() => unsaved ?? saved);
  const [menu, setMenu] = useState(false);
  const dirty = !sameItems(items, saved);

  const change = (next: GridItem[]) => {
    unsaved = sameItems(next, saved) ? null : next;
    setItems(next);
  };
  const save = () => {
    onSave({ gridLayout: items });
    setSaved(items);
    unsaved = null;
  };
  const reset = () => change(saved);

  const all = defs();
  const removed = all.filter((d) => !items.some((i) => i.id === d.id));

  return (
    <div className="content">
      <PageHead title={t('nav.grid')}>
        <button title={t('grid.save')} className={`btn btn-sm${dirty ? ' btn-primary' : ''}`} onClick={save} disabled={!dirty}>
          {dirty && <span className="dirty-dot" aria-hidden="true" />} {t('grid.save')}
        </button>
        <button title={t('grid.reset')} className="btn btn-sm" onClick={reset} disabled={!dirty}>{t('grid.reset')}</button>
        <button title={t('grid.restoreDefault')} className="btn btn-sm" onClick={() => change(DEFAULT_ITEMS)} disabled={sameItems(items, DEFAULT_ITEMS)}>
          {t('grid.restoreDefault')}
        </button>
        {removed.length > 0 && (
          <div className="menu-wrap">
            <button title={t('grid.add')} className="btn btn-sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>
              <Icon name="plus" /> {t('grid.add')}
            </button>
            {menu && (
              <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                {removed.map((d) => (
                  <button
                    key={d.id}
                    title={d.title}
                    className="menu-item"
                    role="menuitem"
                    onClick={() => { change(addItem(items, d)); setMenu(false); }}
                  >
                    <Icon name={d.icon} /> {d.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </PageHead>
      <div className="scroll">
        <PanelGrid items={items} defs={all} render={(id) => <PanelContent id={id as PanelId} />} onChange={change} />
      </div>
    </div>
  );
}

function PanelContent({ id }: { id: PanelId }): ReactNode {
  switch (id) {
    case 'clock':
      return <ClockPanel />;
    case 'info':
      return <InfoPanel />;
    case 'update':
      return <UpdatePanel />;
    case 'list':
      return <ListPanel />;
  }
}

function ClockPanel() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div>
      <div className="mono" style={{ fontSize: 32, fontWeight: 500 }}>{now.toLocaleTimeString()}</div>
      <div className="muted">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  );
}

function InfoPanel() {
  const info = useAsync(() => api.info(), []);
  if (info.error) {
    return (
      <PanelNotice
        icon={<Icon name="alert" size={20} />}
        tone="err"
        title={t('grid.loadFailed')}
        message={errorMessage(info.error)}
        action={<button title={t('common.retry')} className="btn btn-sm" onClick={info.reload}><Icon name="refresh" /> {t('common.retry')}</button>}
      />
    );
  }
  if (!info.data) return <PanelLoading />;
  const rows: Array<[string, string]> = [
    [t('home.version'), info.data.version],
    [t('home.platform'), `${info.data.platform} / ${info.data.arch}`],
    [t('home.host'), info.data.hostname],
    [t('home.runtime'), `bun ${info.data.bun}`],
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
}

function UpdatePanel() {
  const state = useAsync(() => api.update(), [], 60_000);
  const u = state.data;
  if (!u) {
    if (!state.error) return <PanelLoading />;
    return (
      <PanelNotice
        icon={<Icon name="alert" size={20} />}
        tone="err"
        title={t('grid.loadFailed')}
        message={errorMessage(state.error)}
        action={<button title={t('common.retry')} className="btn btn-sm" onClick={state.reload}><Icon name="refresh" /> {t('common.retry')}</button>}
      />
    );
  }
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
}

const LIST_ITEMS = ['grid.list.drag', 'grid.list.resize', 'grid.list.collapse', 'grid.list.remove'] as const;

function ListPanel() {
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {LIST_ITEMS.map((key) => <li key={key}>{t(key)}</li>)}
    </ul>
  );
}
