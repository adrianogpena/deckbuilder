import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { resolveIconSetId, resolveLayout, type Layout, type LayoutStructure } from '@deckbuilder/server-core/layouts';
import { BaseAppFrame, type AppFrameProps } from './components/AppFrame';
import { BaseSidebar, type SidebarProps } from './components/Sidebar';
import { BaseStatusBar, type StatusBarProps } from './components/StatusBar';
import { BaseTabBar, type TabBarProps } from './components/TabWorkspace';

export interface ShellComponents {
  Frame: ComponentType<AppFrameProps>;
  Sidebar: <Id extends string>(props: SidebarProps<Id>) => ReactNode;
  TabBar: <R>(props: TabBarProps<R>) => ReactNode;
  StatusBar: ComponentType<StatusBarProps>;
}

const SHELLS: Record<string, Partial<ShellComponents>> = {};

/** Swaps shell parts for a layout id; slots left out keep the base components. */
export function registerShell(layoutId: string, parts: Partial<ShellComponents>): void {
  SHELLS[layoutId] = { ...SHELLS[layoutId], ...parts };
}

export interface LayoutContext {
  layout: Layout;
  structure: LayoutStructure;
  iconSet: string;
  shell: ShellComponents;
}

type Base = Pick<LayoutContext, 'layout' | 'iconSet'>;

const original = resolveLayout();
const Ctx = createContext<Base>({ layout: original, iconSet: resolveIconSetId(original) });

export function LayoutProvider({ layout, icons, children }: { layout?: string; icons?: string; children: ReactNode }) {
  const resolved = resolveLayout(layout);
  const iconSet = resolveIconSetId(resolved, icons);
  const value = useMemo(() => ({ layout: resolved, iconSet }), [resolved, iconSet]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLayout(): LayoutContext {
  const { layout, iconSet } = useContext(Ctx);
  return useMemo(() => {
    const parts = SHELLS[layout.id] ?? {};
    const shell: ShellComponents = {
      Frame: parts.Frame ?? BaseAppFrame,
      Sidebar: parts.Sidebar ?? BaseSidebar,
      TabBar: parts.TabBar ?? BaseTabBar,
      StatusBar: parts.StatusBar ?? BaseStatusBar,
    };
    return { layout, structure: layout.structure, iconSet, shell };
  }, [layout, iconSet]);
}
