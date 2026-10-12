import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { t, type BaseKey } from '../i18n';
import type { CommandDef } from '../keybindings';
import {
  MAX_PANES,
  activate,
  activeTab,
  addTab,
  closeTab,
  closeTabs,
  cycleTab,
  distinguishingFolders,
  findTab,
  goBack,
  goForward,
  moveTab,
  navigate,
  newTab,
  pinTab,
  selectIndex,
  setDirty,
  tabsToClose,
  layoutTree,
  resizeSplit,
  splitPane,
  type CloseMode,
  type Layout,
  type Pane,
  type SplitNode,
  type Tab,
} from '../tabs';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useCommand } from './Keybindings';
import { SplitView } from './SplitView';
import { Icon, type IconName, type Tone, useDialogs } from './ui';

const DRAG_TYPE = 'application/x-deckbuilder-tab';

export interface TabTitle {
  title: string;
  tooltip?: string;
  icon?: IconName;
  tone?: Tone;
  /** The folder of the tab's item, `/`-separated: shown dimmed after the title when another tab of the pane has the same title. */
  location?: string;
}

interface TabBarProps<R> {
  pane: Pane<R>;
  focused: boolean;
  canSplit: boolean;
  canClosePane: boolean;
  titleOf: (route: R) => TabTitle;
  menuOf?: (route: R) => Array<ContextMenuItem | 'sep'>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseMode: (tabId: string, mode: CloseMode) => void;
  onPin: (tabId: string) => void;
  onNew: () => void;
  onSplit: (side: 'right' | 'down') => void;
  onClosePane: () => void;
  onBack: () => void;
  onForward: () => void;
  onDropTab: (tabId: string, index: number) => void;
}

function TabBar<R>(props: TabBarProps<R>) {
  const { pane, focused, titleOf } = props;
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'> } | null>(null);
  const active = pane.tabs.find((x) => x.id === pane.active) ?? pane.tabs[0];
  const titles = pane.tabs.map((tab) => titleOf(tab.route));
  const folders = distinguishingFolders(titles);

  const menuItems = (tab: Tab<R>, i: number): Array<ContextMenuItem | 'sep'> => {
    const closing: ContextMenuItem[] = [
      { id: 'close', label: t('tabs.menu.close'), run: () => props.onClose(tab.id) },
      { id: 'closeOthers', label: t('tabs.menu.closeOthers'), disabled: pane.tabs.length < 2, run: () => props.onCloseMode(tab.id, 'others') },
      { id: 'closeRight', label: t('tabs.menu.closeRight'), disabled: i === pane.tabs.length - 1, run: () => props.onCloseMode(tab.id, 'right') },
      { id: 'closeSaved', label: t('tabs.menu.closeSaved'), disabled: pane.tabs.every((x) => x.dirty), run: () => props.onCloseMode(tab.id, 'saved') },
      { id: 'closeAll', label: t('tabs.menu.closeAll'), run: () => props.onCloseMode(tab.id, 'all') },
    ];
    const extra = props.menuOf?.(tab.route) ?? [];
    return extra.length ? [...closing, 'sep', ...extra] : closing;
  };

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
          const { title, tooltip, icon, tone } = titles[i];
          const folder = folders[i];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === pane.active}
              className={`tab-chip${tab.id === pane.active ? ' active' : ''}${tab.preview ? ' preview' : ''}${tab.dirty ? ' dirty' : ''}${dropAt === i ? ' drop-before' : ''}`}
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
              onDoubleClick={() => props.onPin(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, items: menuItems(tab, i) });
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && props.onClose(tab.id)}
            >
              {icon && (
                  <span className={`tab-icon${tone ? ` tone-${tone}` : ''}`}>
                    <Icon name={icon} size={13} />
                  </span>
                )}
                <span className="tab-title">
                  {title}
                  {folder && <span className="tab-dir">{folder}</span>}
                </span>
              <button
                className="tab-close"
                title={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                {tab.dirty && <span className="tab-dot" aria-label={t('tabs.unsaved')}>●</span>}
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
        <button className="btn btn-ghost btn-sm" onClick={() => props.onSplit('right')} disabled={!props.canSplit} title={t('tabs.splitRight')} data-split-right>
          <Icon name="split" size={15} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => props.onSplit('down')} disabled={!props.canSplit} title={t('tabs.splitDown')} data-split-down>
          <Icon name="split-down" size={15} />
        </button>
        {props.canClosePane && (
          <button className="btn btn-ghost btn-sm" onClick={props.onClosePane} title={t('tabs.closePane')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {menu && <ContextMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Commands of a tab workspace shown in view `scope`: Alt+1..9 select a tab of the focused pane;
 * Ctrl+T, Ctrl+W and Ctrl+Tab / Ctrl+Shift+Tab only in the native window (Edge and Chrome keep
 * them in browser and app mode). Ctrl+Alt+S saves every tab with unsaved changes (VS Code's
 * Ctrl+K S needs a two-key chord, which the keymap doesn't have).
 */
export function tabCommands(scope: string): CommandDef[] {
  const desktop = (name: string, key: string): CommandDef => ({ id: `${scope}.tab.${name}`, scope, label: t(`keys.tab.${name}` as BaseKey), keys: [key], desktopOnly: true });
  return [
    desktop('new', 'Ctrl+T'),
    desktop('close', 'Ctrl+W'),
    desktop('next', 'Ctrl+Tab'),
    desktop('prev', 'Ctrl+Shift+Tab'),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `${scope}.tab.select${i + 1}`, scope, label: t('keys.tab.select', { n: i + 1 }), keys: [`Alt+${i + 1}`] })),
    { id: `${scope}.tab.saveAll`, scope, label: t('keys.tab.saveAll'), keys: ['Ctrl+Alt+S'] },
  ];
}

/**
 * Binds `tabCommands(scope)` to the layout. `TabWorkspace` installs these itself; call this only
 * for a layout shown another way. `onClose` replaces the plain close of Ctrl+W (to ask about unsaved
 * changes first); Save All is bound by `TabWorkspace` only.
 */
export function useTabKeys<R>(layout: Layout<R>, onChange: (next: Layout<R>) => void, newRoute: () => R, scope: string, onClose?: (tabId: string) => void) {
  const [add, close, next, prev, ...select] = tabCommands(scope);
  useCommand(add, () => onChange(addTab(layout, newTab(newRoute()))));
  useCommand(close, () => (onClose ? onClose(activeTab(layout).id) : onChange(closeTab(layout, activeTab(layout).id, () => newTab(newRoute())))));
  useCommand(next, () => onChange(cycleTab(layout, 1)));
  useCommand(prev, () => onChange(cycleTab(layout, -1)));
  // Always nine, so the hook order is fixed.
  for (let i = 0; i < select.length; i++) useCommand(select[i], () => onChange(selectIndex(layout, i)));
}

export interface TabContext<R> {
  /** The tab is the selected one of its pane. */
  visible: boolean;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  /** Shows another route in this tab; the previous one stays reachable with Back. */
  navigate: (route: R) => void;
  /** Reports whether the tab has unsaved changes; closing it then asks Save / Don't Save / Cancel. */
  setDirty: (dirty: boolean) => void;
  /** Registers what saves the tab (resolves true when it is saved or had nothing to save); Save All and the close dialog call it. */
  setSaver: (save: (() => Promise<boolean>) | undefined) => void;
}

interface TabWorkspaceProps<R> {
  layout: Layout<R>;
  onChange: (next: Layout<R>) => void;
  /** Every tab of every pane stays mounted; hidden ones keep their state. */
  renderTab: (tab: Tab<R>, ctx: TabContext<R>) => ReactNode;
  titleOf: (route: R) => TabTitle;
  /** Context menu of a tab; none when it returns no items. */
  menuOf?: (route: R) => Array<ContextMenuItem | 'sep'>;
  /** The route of a tab opened with the "+" button or Ctrl+T, and of the tab that replaces the last one closed. */
  newRoute: () => R;
  /** The view id the tab shortcuts belong to (see `tabCommands`). */
  scope: string;
}

export function TabWorkspace<R>({ layout, onChange, renderTab, titleOf, menuOf, newRoute, scope }: TabWorkspaceProps<R>) {
  const { choose, element } = useDialogs();
  const savers = useRef(new Map<string, () => Promise<boolean>>());

  // Handlers read the layout of the latest change, so two changes in one tick don't overwrite each other.
  const latest = useRef(layout);
  latest.current = layout;
  const update = (fn: (l: Layout<R>) => Layout<R>) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  };
  const fresh = () => newTab(newRoute());

  /** Saves the tabs one after another; false as soon as one fails (its own banner says why). */
  const saveTabs = async (tabIds: string[]) => {
    for (const id of tabIds) {
      if (!(await savers.current.get(id)?.())) return false;
    }
    return true;
  };
  const saveAll = () => void saveTabs(latest.current.panes.flatMap((p) => p.tabs.filter((x) => x.dirty).map((x) => x.id)));

  /** Closes the tabs, first asking once about the ones with unsaved changes; Cancel or a failed save keeps them all open. */
  const closeMany = async (tabIds: string[]) => {
    const dirty = tabIds.flatMap((id) => {
      const tab = findTab(latest.current, id);
      return tab?.dirty ? [tab] : [];
    });
    if (dirty.length) {
      const choice = await choose({
        title: t('tabs.unsavedTitle'),
        body: dirty.length === 1 ? t('tabs.unsavedOne', { name: titleOf(dirty[0].route).title }) : t('tabs.unsavedMany', { count: dirty.length }),
        choices: [
          { id: 'save', label: t('tabs.save') },
          { id: 'discard', label: t('tabs.dontSave'), danger: true },
        ],
      });
      if (!choice) return;
      if (choice === 'save' && !(await saveTabs(dirty.map((x) => x.id)))) return;
    }
    update((l) => closeTabs(l, tabIds.filter((id) => findTab(l, id)), fresh));
  };
  const closeById = (tabId: string) => void closeMany([tabId]);
  const closeMode = (tabId: string, mode: CloseMode) => void closeMany(tabsToClose(latest.current, tabId, mode).map((x) => x.id));

  useTabKeys(layout, onChange, newRoute, scope, closeById);
  useCommand(tabCommands(scope).at(-1)!, saveAll);

  const renderPane = (pane: Pane<R>) => {
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
          menuOf={menuOf}
          onActivate={(tabId) => update((l) => activate(l, pane.id, tabId))}
          onClose={closeById}
          onCloseMode={closeMode}
          onPin={(tabId) => update((l) => pinTab(l, tabId))}
          onNew={() => update((l) => addTab(l, fresh(), pane.id))}
          onSplit={(side) => update((l) => splitPane(l, activeId, side))}
          onClosePane={() => void closeMany(pane.tabs.map((x) => x.id))}
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
                  setDirty: (dirty) => Boolean(findTab(latest.current, tab.id)?.dirty) !== dirty && update((l) => setDirty(l, tab.id, dirty)),
                  setSaver: (save) => {
                    if (save) savers.current.set(tab.id, save);
                    else savers.current.delete(tab.id);
                  },
                })}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const paneById = new Map(layout.panes.map((p) => [p.id, p]));
  const renderNode = (node: SplitNode, path: number[]): ReactNode => {
    if ('pane' in node) {
      const pane = paneById.get(node.pane);
      return pane ? renderPane(pane) : null;
    }
    return (
      <SplitView
        key={path.length ? `split:${firstPane(node)}` : 'root'}
        direction={node.dir}
        sizes={node.sizes}
        min={node.children.map(() => PANE_MIN_PX)}
        onResize={(sizes) => update((l) => resizeSplit(l, path, sizes))}
      >
        {node.children.map((child, i) => renderNode(child, [...path, i]))}
      </SplitView>
    );
  };

  // A single pane still sits in the root SplitView, so splitting it keeps it mounted.
  const tree = layoutTree(layout);
  return (
    <div className="panes">
      {element}
      {'pane' in tree ? (
        <SplitView key="root" direction="row" sizes={[1]} onResize={() => {}}>
          {renderNode(tree, [])}
        </SplitView>
      ) : (
        renderNode(tree, [])
      )}
    </div>
  );
}

const PANE_MIN_PX = 160;

const firstPane = (node: SplitNode): string => ('pane' in node ? node.pane : firstPane(node.children[0]));
