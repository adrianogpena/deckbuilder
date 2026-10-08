import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { isDesktop } from '../api';
import { useKey } from '../hooks';
import { t } from '../i18n';
import {
  MAX_PANES,
  activate,
  activeTab,
  addTab,
  closeTab,
  cycleTab,
  findTab,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  selectIndex,
  splitRight,
  type Layout,
  type Pane,
  type Tab,
} from '../tabs';
import { Icon } from './ui';

const DRAG_TYPE = 'application/x-deckbuilder-tab';

export interface TabTitle {
  title: string;
  tooltip?: string;
}

interface TabBarProps<R> {
  pane: Pane<R>;
  focused: boolean;
  canSplit: boolean;
  canClosePane: boolean;
  titleOf: (route: R) => TabTitle;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onSplit: () => void;
  onClosePane: () => void;
  onBack: () => void;
  onForward: () => void;
  onDropTab: (tabId: string, index: number) => void;
}

function TabBar<R>(props: TabBarProps<R>) {
  const { pane, focused, titleOf } = props;
  const [dropAt, setDropAt] = useState<number | null>(null);
  const active = pane.tabs.find((x) => x.id === pane.active) ?? pane.tabs[0];

  const onDragOver = (e: DragEvent, index: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt(index);
  };

  const onDrop = (e: DragEvent, index: number) => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    setDropAt(null);
    if (id) {
      e.preventDefault();
      props.onDropTab(id, index);
    }
  };

  return (
    <div
      className={`tabbar${focused ? ' focused' : ''}`}
      onDragOver={(e) => onDragOver(e, pane.tabs.length)}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => onDrop(e, pane.tabs.length)}
    >
      <div className="tabbar-tools">
        <button className="btn btn-ghost btn-sm" onClick={props.onBack} disabled={!active?.back.length} title={t('tabs.back')}>
          <Icon name="back" size={15} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={props.onForward} disabled={!active?.forward.length} title={t('tabs.forward')}>
          <Icon name="forward" size={15} />
        </button>
      </div>
      <div className="tabs-strip" role="tablist">
        {pane.tabs.map((tab, i) => {
          const { title, tooltip } = titleOf(tab.route);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === pane.active}
              className={`tab-chip${tab.id === pane.active ? ' active' : ''}${dropAt === i ? ' drop-before' : ''}`}
              title={tooltip ?? title}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.stopPropagation();
                onDragOver(e, i);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(e, i);
              }}
              onClick={() => props.onActivate(tab.id)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && props.onClose(tab.id)}
            >
              <span className="tab-title">{title}</span>
              <button
                className="tab-close"
                title={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
        <button className="btn btn-ghost btn-sm tab-new" onClick={props.onNew} title={t('tabs.new')}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="tabbar-tools">
        <button className="btn btn-ghost btn-sm" onClick={props.onSplit} disabled={!props.canSplit} title={t('tabs.split')}>
          <Icon name="split" size={15} />
        </button>
        {props.canClosePane && (
          <button className="btn btn-ghost btn-sm" onClick={props.onClosePane} title={t('tabs.closePane')}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Alt+1..9 select a tab of the focused pane. Ctrl+T, Ctrl+W and Ctrl+Tab / Ctrl+Shift+Tab only
 * in the native window: Edge and Chrome keep them in browser and app mode.
 * `TabWorkspace` installs these itself; call this only for a layout shown another way.
 */
export function useTabKeys<R>(layout: Layout<R>, onChange: (next: Layout<R>) => void, newRoute: () => R) {
  useKey((e) => {
    if (e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        onChange(selectIndex(layout, Number(digit[1]) - 1));
      }
      return;
    }
    if (!isDesktop || !e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      onChange(cycleTab(layout, e.shiftKey ? -1 : 1));
    } else if (e.shiftKey) {
      return;
    } else if (e.key.toLowerCase() === 't') {
      e.preventDefault();
      onChange(addTab(layout, newTab(newRoute())));
    } else if (e.key.toLowerCase() === 'w') {
      e.preventDefault();
      onChange(closeTab(layout, activeTab(layout).id, () => newTab(newRoute())));
    }
  });
}

export interface TabContext<R> {
  /** The tab is the selected one of its pane. */
  visible: boolean;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  /** Shows another route in this tab; the previous one stays reachable with Back. */
  navigate: (route: R) => void;
}

interface TabWorkspaceProps<R> {
  layout: Layout<R>;
  onChange: (next: Layout<R>) => void;
  /** Every tab of every pane stays mounted; hidden ones keep their state. */
  renderTab: (tab: Tab<R>, ctx: TabContext<R>) => ReactNode;
  titleOf: (route: R) => TabTitle;
  /** The route of a tab opened with the "+" button or Ctrl+T, and of the tab that replaces the last one closed. */
  newRoute: () => R;
}

export function TabWorkspace<R>({ layout, onChange, renderTab, titleOf, newRoute }: TabWorkspaceProps<R>) {
  useTabKeys(layout, onChange, newRoute);

  // Handlers read the layout of the latest change, so two changes in one tick don't overwrite each other.
  const latest = useRef(layout);
  latest.current = layout;
  const update = (fn: (l: Layout<R>) => Layout<R>) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  };
  const fresh = () => newTab(newRoute());
  const closeById = (tabId: string) => update((l) => closeTab(l, tabId, fresh));

  return (
    <div className="panes" style={{ gridTemplateColumns: `repeat(${layout.panes.length}, minmax(0, 1fr))` }}>
      {layout.panes.map((pane) => {
        const paneFocused = pane.id === layout.focused;
        const activeId = pane.tabs.some((x) => x.id === pane.active) ? pane.active : pane.tabs[0]?.id;
        return (
          <section
            key={pane.id}
            className={`pane${paneFocused && layout.panes.length > 1 ? ' focused' : ''}`}
            onMouseDownCapture={() => !paneFocused && update((l) => ({ ...l, focused: pane.id }))}
          >
            <TabBar
              pane={pane}
              focused={paneFocused}
              canSplit={layout.panes.length < MAX_PANES}
              canClosePane={layout.panes.length > 1}
              titleOf={titleOf}
              onActivate={(tabId) => update((l) => activate(l, pane.id, tabId))}
              onClose={closeById}
              onNew={() => update((l) => addTab(l, fresh(), pane.id))}
              onSplit={() => update((l) => splitRight(l, activeId))}
              onClosePane={() =>
                update((l) => pane.tabs.reduce((next, tab) => closeTab(next, tab.id, fresh), l))
              }
              onBack={() => update((l) => goBack(l, activeId))}
              onForward={() => update((l) => goForward(l, activeId))}
              onDropTab={(tabId, index) =>
                update((l) => {
                  // Dropping later in the same pane: the index counts the tab being moved.
                  const from = pane.tabs.findIndex((x) => x.id === tabId);
                  return moveTab(l, tabId, pane.id, from >= 0 && from < index ? index - 1 : index);
                })
              }
            />
            <div className="pane-body">
              {pane.tabs.map((tab) => {
                const visible = tab.id === activeId;
                return (
                  <div key={tab.id} className={`tab-view${visible ? '' : ' hidden'}`} role="tabpanel">
                    {renderTab(tab, {
                      visible,
                      focused: visible && paneFocused,
                      navigate: (route) => update((l) => (findTab(l, tab.id) ? navigate(l, tab.id, route) : l)),
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
