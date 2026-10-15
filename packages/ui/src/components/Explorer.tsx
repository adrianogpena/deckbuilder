import type { ReactNode } from 'react';
import { t } from '../i18n';
import type { CommandDef } from '../keybindings';
import { useCommand } from './Keybindings';
import { SplitView } from './SplitView';
import { Icon } from './ui';

const MIN = [180];
const DEFAULT_SIZES = [0.25, 0.75];

export interface ExplorerProps {
  sidebar: ReactNode;
  /** Fractions of the sidebar and the workspace; unchanged while collapsed. */
  sizes: [number, number];
  onResize: (sizes: [number, number]) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The workspace, usually a `TabWorkspace`; stays mounted when the sidebar collapses. */
  children: ReactNode;
  /** The view id the Ctrl+B command belongs to (see `explorerCommands`). */
  scope: string;
  /** Hides the sidebar and its rail for now (Zen mode, a maximized pane) without touching `collapsed`. */
  hidden?: boolean;
  /** Which side the sidebar sits on; `sizes` stay [sidebar, workspace] either way. */
  side?: 'left' | 'right';
  /** Extra class on the root (e.g. `screen-edges`). */
  className?: string;
}

/** Commands of an Explorer shown in view `scope`: Ctrl+B toggles the sidebar (not while typing). */
export function explorerCommands(scope: string): CommandDef[] {
  return [{ id: `${scope}.toggleSidebar`, scope, label: t('keys.toggleSidebar'), keys: ['Ctrl+B'], inInput: false }];
}

/**
 * A resizable sidebar (min 180 px) next to a workspace. Ctrl+B or the rail button toggle the
 * sidebar. Layout only: the app owns sizes, collapsed and what the sidebar and workspace show.
 */
export function Explorer({ sidebar, sizes, onResize, collapsed: stored, onCollapsedChange, children, scope, hidden = false, side = 'left', className }: ExplorerProps) {
  const [toggle] = explorerCommands(scope);
  useCommand(toggle, () => onCollapsedChange(!stored), { enabled: !hidden });
  const collapsed = stored || hidden;
  const right = side === 'right';

  // The workspace keeps its key and slot either way, so its tabs aren't remounted.
  return (
    <div className={className ? `explorer ${className}` : 'explorer'}>
      {collapsed && !hidden && (
        <div className="explorer-rail" style={{ order: right ? 1 : 0, ...(right ? { borderRight: 0, borderLeft: '1px solid var(--border-soft)' } : null) }}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onCollapsedChange(false)} title={t('explorer.toggleSidebar')} aria-label={t('explorer.toggleSidebar')}>
            <Icon name="sidebar" />
          </button>
        </div>
      )}
      <SplitView
        direction="row"
        sizes={collapsed ? [1] : right ? [sizes[1], sizes[0]] : sizes}
        defaultSizes={right ? [DEFAULT_SIZES[1], DEFAULT_SIZES[0]] : DEFAULT_SIZES}
        min={collapsed ? [] : right ? [0, MIN[0]] : MIN}
        onResize={(next) => !collapsed && onResize(right ? [next[1], next[0]] : [next[0], next[1]])}
      >
        {!collapsed && !right && (
          <div key="sidebar" className="explorer-side">
            {sidebar}
          </div>
        )}
        <div key="workspace" className="explorer-main">
          {children}
        </div>
        {!collapsed && right && (
          <div key="sidebar" className="explorer-side">
            {sidebar}
          </div>
        )}
      </SplitView>
    </div>
  );
}
