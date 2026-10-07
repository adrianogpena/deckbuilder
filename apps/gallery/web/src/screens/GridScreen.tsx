import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addItem,
  Badge,
  errorMessage,
  Icon,
  PageHead,
  PanelBanner,
  PanelGrid,
  PanelLoading,
  PanelNotice,
  useAsync,
  type GridItem,
  type PanelDef,
} from '@deckbuilder/ui';
import { api, type Settings } from '../api';
import { t } from '../i18n';

const PANEL_IDS = ['clock', 'info', 'update', 'list'] as const;
type PanelId = (typeof PANEL_IDS)[number];

const def = (id: PanelId, icon: string): PanelDef => ({
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

const isItem = (x: unknown): x is GridItem => {
  const i = x as Partial<GridItem> | null;
  return !!i && typeof i === 'object' && PANEL_IDS.includes(i.id as PanelId)
    && [i.x, i.y, i.w, i.h].every((n) => Number.isInteger(n));
};

/** The saved layout, or the default one when nothing valid was saved. */
function restoreItems(raw: unknown): GridItem[] {
  return Array.isArray(raw) && raw.every(isItem) ? raw : DEFAULT_ITEMS;
}

const SAVE_DELAY_MS = 500;

export function GridScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [items, setItems] = useState(() => restoreItems(settings.gridLayout));
  const [menu, setMenu] = useState(false);

  const timer = useRef<number>();
  const pending = useRef<GridItem[]>();
  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current) onSave({ gridLayout: pending.current });
    pending.current = undefined;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  const change = (next: GridItem[]) => {
    setItems(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  const all = defs();
  const removed = all.filter((d) => !items.some((i) => i.id === d.id));

  return (
    <div className="content">
      <PageHead crumb={t('grid.crumb')} title={t('nav.grid')}>
        {removed.length > 0 && (
          <div className="menu-wrap">
            <button className="btn btn-sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>
              <Icon name="plus" /> {t('grid.add')}
            </button>
            {menu && (
              <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                {removed.map((d) => (
                  <button
                    key={d.id}
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
        action={<button className="btn btn-sm" onClick={info.reload}><Icon name="refresh" /> {t('common.retry')}</button>}
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
        action={<button className="btn btn-sm" onClick={state.reload}><Icon name="refresh" /> {t('common.retry')}</button>}
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
