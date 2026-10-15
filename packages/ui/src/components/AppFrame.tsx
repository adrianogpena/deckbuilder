import type { ReactNode } from 'react';
import { useLayout } from '../layout';

export interface AppFrameProps {
  zen?: boolean;
  sidebar: ReactNode;
  /** Global tools; the base frame ignores them (the sidebar footer already shows them). */
  tools?: ReactNode;
  children: ReactNode;
}

export function BaseAppFrame({ zen, sidebar, children }: AppFrameProps) {
  const { structure } = useLayout();
  const collapsed = structure.sidebarMode === 'collapsed';
  const right = structure.sidebarSide === 'right';
  return (
    <div className={`app${collapsed ? ' nav-collapsed' : ''}${zen ? ' zen' : ''}${right ? ' sidebar-right' : ''}`}>
      {sidebar}
      {children}
    </div>
  );
}

export function AppFrame(props: AppFrameProps) {
  const { Frame } = useLayout().shell;
  return <Frame {...props} />;
}
