import { useMemo, useState } from 'react';
import { addItem, Button, ContextMenu, Empty, PageHead, PanelGrid, sameItems, t, useDialogs, type ContextMenuItem, type GridItem, type PanelConfig } from '@deckbuilderkit/ui';
import { ConfigDialog } from '../ConfigForm';
import { ConnectionsDialog } from '../connections/ConnectionsDialog';
import { tKey } from '../i18n';
import { fieldsOf, kindSpecs, panelDef, type AnyPanelKind } from '../panel';
import { addableKinds, PanelCreator } from '../PanelCreator';
import { PanelHost } from '../PanelHost';
import { activeLayout, layoutsOrDefault, MAX_LAYOUTS, MAX_NAME, newLayoutId, type DashboardLayouts } from './model';
import '../grid.css';
import './dashboard.css';

/** The slice of the app settings the screen reads and writes. */
export interface DashboardViewSettings {
  /** Saved layouts (`DashboardLayouts`); the server validates them. */
  dashboardLayouts?: unknown;
}

/** Unsaved items of a layout, kept while another screen is shown; a restart drops them. */
let unsaved: { layoutId: string; items: GridItem[] } | null = null;

export interface DashboardScreenProps {
  settings: DashboardViewSettings;
  onSave: (patch: DashboardViewSettings) => void;
  panels: readonly AnyPanelKind[];
}

const nameError = (value: string): string | null => (value.trim().length >= 1 && value.trim().length <= MAX_NAME ? null : tKey('dash.nameInvalid'));

export function DashboardScreen({ settings, onSave, panels }: DashboardScreenProps) {
  const specs = useMemo(() => kindSpecs(panels), [panels]);
  const defs = useMemo(() => panels.map((k) => panelDef(k, tKey(k.title))), [panels]);
  const [state, setState] = useState<DashboardLayouts>(() => layoutsOrDefault(settings.dashboardLayouts, specs, tKey('dash.defaultName')));
  const [items, setItems] = useState<GridItem[]>(() => {
    const current = activeLayout(state);
    return unsaved && unsaved.layoutId === current.id ? unsaved.items : current.items;
  });
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const { confirm, prompt, choose, element } = useDialogs();

  const current = activeLayout(state);
  const dirty = !sameItems(items, current.items);

  const change = (next: GridItem[]) => {
    unsaved = sameItems(next, current.items) ? null : { layoutId: current.id, items: next };
    setItems(next);
  };
  const persist = (next: DashboardLayouts) => {
    setState(next);
    onSave({ dashboardLayouts: next });
  };
  const withItems = (layouts: DashboardLayouts, id: string, next: GridItem[]): DashboardLayouts => ({
    ...layouts,
    layouts: layouts.layouts.map((l) => (l.id === id ? { ...l, items: next } : l)),
  });
  const save = () => {
    persist(withItems(state, current.id, items));
    unsaved = null;
  };
  /** Resolves true when it is fine to leave the layout: nothing unsaved, or the user saved or discarded. */
  const settle = async (): Promise<boolean> => {
    if (!dirty) return true;
    const answer = await choose({
      title: tKey('dash.unsaved.title'),
      body: tKey('dash.unsaved.body', { name: current.name }),
      choices: [
        { id: 'save', label: tKey('dash.unsaved.save') },
        { id: 'discard', label: tKey('dash.unsaved.discard'), danger: true },
      ],
    });
    if (answer === null) return false;
    if (answer === 'save') save();
    else unsaved = null;
    return true;
  };
  const show = (layouts: DashboardLayouts, id: string) => {
    const target = layouts.layouts.find((l) => l.id === id)!;
    persist({ ...layouts, active: id });
    setItems(target.items);
    setConfiguring(null);
  };
  const base = (): DashboardLayouts => (dirty ? withItems(state, current.id, current.items) : state);

  const switchTo = async (id: string) => {
    if (id === current.id || !(await settle())) return;
    show(state, id);
  };
  const askName = (value: string) => prompt({ title: tKey('dash.rename'), label: tKey('dash.nameLabel'), value, validate: nameError });
  const addLayout = async (name: string, from: GridItem[]) => {
    const chosen = await askName(name);
    if (chosen === null) return;
    const id = newLayoutId(state.layouts);
    show({ ...state, layouts: [...state.layouts, { id, name: chosen.trim(), items: from }] }, id);
  };
  const newEmpty = async () => {
    if (!(await settle())) return;
    await addLayout(tKey('dash.newName'), []);
  };
  const duplicate = async () => {
    if (!(await settle())) return;
    await addLayout(tKey('dash.copyName', { name: current.name }), dirty ? items : current.items);
  };
  const rename = async () => {
    const chosen = await askName(current.name);
    if (chosen === null) return;
    persist({ ...base(), layouts: base().layouts.map((l) => (l.id === current.id ? { ...l, name: chosen.trim() } : l)) });
  };
  const remove = async () => {
    if (state.layouts.length <= 1) return;
    const ok = await confirm({ title: tKey('dash.deleteTitle'), body: tKey('dash.deleteBody', { name: current.name }), okLabel: tKey('dash.delete.ok'), danger: true });
    if (!ok) return;
    unsaved = null;
    const rest = state.layouts.filter((l) => l.id !== current.id);
    show({ ...state, layouts: rest }, rest[0]!.id);
  };

  const full = state.layouts.length >= MAX_LAYOUTS;
  const menu: ContextMenuItem[] = [
    { id: 'new', label: tKey('dash.new'), icon: 'plus', disabled: full, hint: full ? tKey('dash.tooMany') : undefined, run: () => void newEmpty() },
    { id: 'duplicate', label: tKey('dash.duplicate'), icon: 'copy', disabled: full, hint: full ? tKey('dash.tooMany') : undefined, run: () => void duplicate() },
    { id: 'rename', label: tKey('dash.rename'), icon: 'edit', run: () => void rename() },
    { id: 'delete', label: tKey('dash.delete'), icon: 'trash', danger: true, disabled: state.layouts.length <= 1, hint: state.layouts.length <= 1 ? tKey('dash.deleteLast') : undefined, run: () => void remove() },
  ];

  const kindOf = (kind: string) => panels.find((k) => k.kind === kind);
  const itemMenu = (item: GridItem): ContextMenuItem[] => {
    const kind = kindOf(item.kind);
    if (!kind || fieldsOf(kind).length === 0) return [];
    return [{ id: 'configure', label: t('panel.configure'), icon: 'settings', run: () => setConfiguring(item.id) }];
  };
  const target = configuring ? items.find((i) => i.id === configuring) : undefined;
  const targetKind = target && kindOf(target.kind);
  const canAdd = addableKinds(panels, items).length > 0;

  return (
    <div className="content">
      <PageHead title={tKey('nav.dashboard')}>
        <select className="dash-layout-select" aria-label={tKey('dash.layout')} value={current.id} onChange={(e) => void switchTo(e.target.value)}>
          {state.layouts.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <Button
          size="sm"
          icon="more"
          title={tKey('dash.menu')}
          aria-label={tKey('dash.menu')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom });
          }}
        />
        <Button size="sm" icon="plus" title={tKey('grid.add')} onClick={() => setCreating(true)} disabled={!canAdd}>{tKey('grid.add')}</Button>
        <Button size="sm" icon="link" title={tKey('dash.connections')} onClick={() => setConnecting(true)}>{tKey('dash.connections')}</Button>
        <Button size="sm" variant={dirty ? 'primary' : 'default'} icon="check" title={tKey('grid.save')} onClick={save} disabled={!dirty}>
          {dirty && <span className="dirty-dot" aria-hidden="true" />} {tKey('grid.save')}
        </Button>
        <Button size="sm" icon="rotate-ccw" title={tKey('grid.reset')} onClick={() => change(current.items)} disabled={!dirty}>{tKey('grid.reset')}</Button>
      </PageHead>
      <div className="scroll">
        {items.length === 0 ? (
          <Empty title={tKey('dash.empty.title')}>
            <p>{tKey('dash.empty.body')}</p>
            <Button icon="plus" variant="primary" onClick={() => setCreating(true)} disabled={!canAdd}>{tKey('grid.add')}</Button>
          </Empty>
        ) : (
          <PanelGrid
            items={items}
            defs={defs}
            render={(item) => {
              const kind = kindOf(item.kind);
              if (!kind) return null;
              return <PanelHost kind={kind} item={item} onConfigure={fieldsOf(kind).length > 0 ? () => setConfiguring(item.id) : undefined} />;
            }}
            itemMenu={itemMenu}
            onChange={change}
          />
        )}
      </div>
      {connecting && <ConnectionsDialog onClose={() => setConnecting(false)} />}
      {menuAt && <ContextMenu at={menuAt} items={menu} onClose={() => setMenuAt(null)} />}
      {creating && (
        <PanelCreator
          kinds={panels}
          items={items}
          onAdd={(kind, config: PanelConfig | undefined) => change(addItem(items, defs.find((d) => d.id === kind.kind)!, config))}
          onClose={() => setCreating(false)}
        />
      )}
      {target && targetKind && (
        <ConfigDialog
          name={target.title ?? tKey(targetKind.title)}
          fields={fieldsOf(targetKind)}
          value={target.config ?? {}}
          onSave={(config) => change(items.map((i) => (i.id === target.id ? { ...i, config } : i)))}
          onClose={() => setConfiguring(null)}
        />
      )}
      {element}
    </div>
  );
}
