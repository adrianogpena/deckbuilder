import { useMemo, useState } from 'react';
import { addItem, Button, PageHead, PanelGrid, sameItems, validGridItems, type ContextMenuItem, type GridItem, type PanelConfig } from '@deckbuilderkit/ui';
import { ConfigDialog } from './ConfigForm';
import { tKey } from './i18n';
import { fieldsOf, kindSpecs, panelDef, type AnyPanelKind } from './panel';
import { PanelHost } from './PanelHost';
import { addableKinds, PanelCreator } from './PanelCreator';
import { t } from '@deckbuilderkit/ui';
import './grid.css';

/** The slice of the app settings the screen reads and writes. */
export interface GridViewSettings {
  /** The saved layout (`GridItem[]`); the server validates it. */
  gridLayout?: unknown;
}

/** Unsaved layout, kept while another screen is shown; a restart drops it. */
let unsaved: GridItem[] | null = null;

export interface GridScreenProps {
  settings: GridViewSettings;
  onSave: (patch: GridViewSettings) => void;
  panels: readonly AnyPanelKind[];
  defaultLayout: readonly GridItem[];
}

export function GridScreen({ settings, onSave, panels, defaultLayout }: GridScreenProps) {
  const specs = useMemo(() => kindSpecs(panels), [panels]);
  const defs = useMemo(() => panels.map((k) => panelDef(k, tKey(k.title))), [panels]);
  const defaults = useMemo(() => [...defaultLayout], [defaultLayout]);
  const [saved, setSaved] = useState(() => validGridItems(settings.gridLayout, specs) ?? defaults);
  const [items, setItems] = useState(() => unsaved ?? saved);
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
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

  const kindOf = (kind: string) => panels.find((k) => k.kind === kind);
  const itemMenu = (item: GridItem): ContextMenuItem[] => {
    const kind = kindOf(item.kind);
    if (!kind || fieldsOf(kind).length === 0) return [];
    return [{ id: 'configure', label: t('panel.configure'), icon: 'settings', run: () => setConfiguring(item.id) }];
  };
  const target = configuring ? items.find((i) => i.id === configuring) : undefined;
  const targetKind = target && kindOf(target.kind);

  return (
    <div className="content">
      <PageHead title={tKey('nav.grid')}>
        <Button size="sm" variant={dirty ? 'primary' : 'default'} icon="check" title={tKey('grid.save')} onClick={save} disabled={!dirty}>
          {dirty && <span className="dirty-dot" aria-hidden="true" />} {tKey('grid.save')}
        </Button>
        <Button size="sm" icon="rotate-ccw" title={tKey('grid.reset')} onClick={() => change(saved)} disabled={!dirty}>{tKey('grid.reset')}</Button>
        <Button size="sm" icon="rotate-ccw" title={tKey('grid.restoreDefault')} onClick={() => change(defaults)} disabled={sameItems(items, defaults)}>
          {tKey('grid.restoreDefault')}
        </Button>
        <Button size="sm" icon="plus" title={tKey('grid.add')} onClick={() => setCreating(true)} disabled={addableKinds(panels, items).length === 0}>
          {tKey('grid.add')}
        </Button>
      </PageHead>
      <div className="scroll">
        <PanelGrid
          items={items}
          defs={defs}
          render={(item) => {
            const kind = kindOf(item.kind);
            return kind ? <PanelHost kind={kind} item={item} /> : null;
          }}
          itemMenu={itemMenu}
          onChange={change}
        />
      </div>
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
    </div>
  );
}
