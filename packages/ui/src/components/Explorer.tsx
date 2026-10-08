import type { ReactNode } from 'react';
import { isTyping, useKey } from '../hooks';
import { t } from '../i18n';
import { SplitView } from './SplitView';
import { Icon, isModalOpen } from './ui';

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
}

/**
 * A resizable sidebar (min 180 px) next to a workspace. Ctrl+B or the rail button toggle the
 * sidebar. Layout only: the app owns sizes, collapsed and what the sidebar and workspace show.
 */
export function Explorer({ sidebar, sizes, onResize, collapsed, onCollapsedChange, children }: ExplorerProps) {
  useKey((e) => {
    if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 'b') return;
    if (isTyping(e) || isModalOpen()) return;
    e.preventDefault();
    onCollapsedChange(!collapsed);
  });

  // The workspace keeps its key and slot either way, so its tabs aren't remounted.
  return (
    <div className="explorer">
      {collapsed && (
        <div className="explorer-rail">
          <button className="btn btn-ghost btn-sm" onClick={() => onCollapsedChange(false)} title={t('explorer.toggleSidebar')} aria-label={t('explorer.toggleSidebar')}>
            <Icon name="sidebar" />
          </button>
        </div>
      )}
      <SplitView direction="row" sizes={collapsed ? [1] : sizes} defaultSizes={DEFAULT_SIZES} min={collapsed ? [] : MIN} onResize={(next) => !collapsed && onResize([next[0], next[1]])}>
        {!collapsed && (
          <div key="sidebar" className="explorer-side">
            {sidebar}
          </div>
        )}
        <div key="workspace" className="explorer-main">
          {children}
        </div>
      </SplitView>
    </div>
  );
}
