import type { ReactNode } from 'react';
import { useLayout } from '../layout';
import { BrandMark } from './ui';

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

/** Islands: the frame is the darker background; the brand sits above the rail island, level with the tab row. */
export function IslandsAppFrame({ zen, sidebar, children }: AppFrameProps) {
  const { structure } = useLayout();
  const collapsed = structure.sidebarMode === 'collapsed';
  const right = structure.sidebarSide === 'right';
  return (
    <div className={`app islands-frame${collapsed ? ' nav-collapsed' : ''}${zen ? ' zen' : ''}${right ? ' sidebar-right' : ''}`}>
      <div className="islands-rail">
        <div className="islands-brand">
          <BrandMark size={22} />
        </div>
        {sidebar}
      </div>
      {children}
    </div>
  );
}

export function AppFrame(props: AppFrameProps) {
  const { Frame } = useLayout().shell;
  return <Frame {...props} />;
}
