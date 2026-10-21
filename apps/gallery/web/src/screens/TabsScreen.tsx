import { useRef, useState } from 'react';
import {
  Button,
  type Layout,
  newTab,
  PageHead,
  restore,
  serialize,
  singlePane,
  type Tab,
  TabWorkspace,
  type TabContext,
  useDebouncedSave,
} from '@deckbuilderkit/ui';
import type { Settings } from '../api';
import { t } from '../i18n';

const PAGES = ['notes', 'counter', 'info'] as const;
type Page = (typeof PAGES)[number];

interface Route {
  page: Page;
  n: number;
}

const isRoute = (x: unknown): x is Route => {
  const r = x as Partial<Route> | null;
  return !!r && typeof r === 'object' && PAGES.includes(r.page as Page) && Number.isInteger(r.n);
};

function highestN(layout: Layout<Route>): number {
  return Math.max(0, ...layout.panes.flatMap((p) => p.tabs.map((x) => x.route.n)));
}

const titleOf = (route: Route) => ({ title: `${t(`tabs.page.${route.page}`)} ${route.n}` });

import { generalSettingsOf } from '../settings';
export function TabsScreen({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>) => void }) {
  const [layout, setLayout] = useState<Layout<Route>>(
    () => restore(settings.tabsLayout, isRoute) ?? singlePane(newTab<Route>({ page: 'notes', n: 1 })),
  );
  const latest = useRef(layout);
  latest.current = layout;

  const save = useDebouncedSave((next: Layout<Route>) => onSave({ tabsLayout: serialize(next) }));
  const change = (next: Layout<Route>) => {
    setLayout(next);
    save(next);
  };

  return (
    <TabWorkspace
      confirmCloseDirty={generalSettingsOf(settings).confirmCloseDirty}
      layout={layout}
      onChange={change}
      titleOf={titleOf}
      newRoute={(): Route => ({ page: 'notes', n: highestN(latest.current) + 1 })}
      scope="tabs"
      renderTab={(tab, ctx) => <TabPage tab={tab} ctx={ctx} />}
    />
  );
}

function TabPage({ tab, ctx }: { tab: Tab<Route>; ctx: TabContext<Route> }) {
  const { route } = tab;
  const [text, setText] = useState('');
  const [count, setCount] = useState(0);

  return (
    <div className="content">
      <PageHead title={titleOf(route).title}>
        <div className="req-tabs" role="tablist">
          {PAGES.map((page) => (
            <button
              key={page}
              title={t(`tabs.page.${page}`)}
              role="tab"
              aria-selected={page === route.page}
              className={`req-tab${page === route.page ? ' active' : ''}`}
              onClick={() => ctx.navigate({ page, n: route.n })}
            >
              {t(`tabs.page.${page}`)}
            </button>
          ))}
        </div>
      </PageHead>
      <div className="scroll">
        {route.page === 'notes' && (
          <section className="section">
            <h4 className="mono-label">{t('tabs.notes.hint')}</h4>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t('tabs.notes.placeholder')} />
          </section>
        )}
        {route.page === 'counter' && (
          <section className="section">
            <h4 className="mono-label">{t('tabs.counter.hint')}</h4>
            <div className="row">
              <Button variant="primary" icon="plus" title={t('tabs.counter.increment')} onClick={() => setCount(count + 1)}>1</Button>
              <span className="mono">{count}</span>
            </div>
          </section>
        )}
        {route.page === 'info' && (
          <section className="section">
            <h4 className="mono-label">{t('tabs.info.hint')}</h4>
            <pre className="card">{JSON.stringify(route, null, 2)}</pre>
          </section>
        )}
      </div>
    </div>
  );
}
