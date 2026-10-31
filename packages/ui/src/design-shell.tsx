import type { ReactNode } from 'react';
import './design-shell.css';
import { Button, IconButton } from './components/Button';
import { Inspector, InspectorRow } from './components/Inspector';
import { BrandMark } from './components/ui';
import type { IconName } from './icons';

/** Design preview, shell variants. Placeholder controls have no handlers; only A's search and chips and C's toggle work. */

export interface CommandBarItem { id: string; label: string; icon: IconName }

/** Variant A: slim top bar with the logo, a palette field and the view switcher chips. */
export function CommandBar({ name, items, current, onSelect, onSearch, tools }: {
  name: string; items: CommandBarItem[]; current: string; onSelect: (id: string) => void; onSearch: () => void; tools?: ReactNode;
}) {
  return (
    <header className="design-cmdbar">
      <div className="design-cmdbar-brand"><BrandMark size={20} /><span>{name}</span></div>
      <Button size="sm" icon="search" className="design-cmdbar-field" onClick={onSearch}>
        <span className="design-cmdbar-hint">Search or run a command…</span>
        <kbd className="design-cmdbar-kbd">Ctrl K</kbd>
      </Button>
      <nav className="design-cmdbar-chips" aria-label="Views">
        {items.map((i) => (
          <Button key={i.id} size="xs" variant="ghost" icon={i.icon} pressed={i.id === current} onClick={() => onSelect(i.id)}>{i.label}</Button>
        ))}
      </nav>
      <div className="design-cmdbar-tools">{tools}</div>
    </header>
  );
}

/** Variant A: bottom activity strip in place of the status bar (placeholder facts). */
export function ActivityStrip() {
  return (
    <footer className="design-strip">
      <span>git: 2 ahead</span><span>·</span><span>tsc ok</span><span>·</span><span>timesheet 5h12</span><span>·</span><span>rate 6.31</span>
      <span className="design-strip-spacer" />
      <span>3 jobs</span>
    </footer>
  );
}

/** Variant B: layout-preset row under the ribbon. Render only. */
export function LayoutPresetRow() {
  return (
    <div className="design-presets">
      <Button size="sm">Layout: Review ▾</Button>
      <span className="design-presets-sep" />
      <Button size="sm" variant="ghost" pressed>Review</Button>
      <Button size="sm" variant="ghost">Debug</Button>
      <Button size="sm" variant="ghost">Focus</Button>
      <span className="design-presets-spacer" />
      <Button size="sm" icon="plus">+ pane</Button>
    </div>
  );
}

/** Variant C: header toggle for the inspector. */
export function InspectorToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <IconButton icon="panel-right" label={open ? 'Hide inspector' : 'Show inspector'} pressed={open} onClick={onToggle} />;
}

/** Variant C: the inspector with placeholder content. */
export function ShellInspector({ onClose }: { onClose: () => void }) {
  return (
    <Inspector
      title="KEDALION-123"
      subtitle="Ticket"
      onClose={onClose}
      actions={<><Button size="sm" variant="primary">Open</Button><Button size="sm">Branch</Button><Button size="sm">Log</Button></>}
    >
      <InspectorRow label="Status">In review</InspectorRow>
      <InspectorRow label="Branch">feature/KEDALION-123</InspectorRow>
      <InspectorRow label="PR">#482 · 2 approvals</InspectorRow>
    </Inspector>
  );
}
