import { useEffect, type ReactNode } from 'react';
import { useLayout } from '../layout';
import { HeaderNav } from './HeaderNav';
import { BrandMark, Icon, type IconName } from './ui';

export interface NavItem<Id extends string = string> {
  id: Id;
  /** Display text (already translated). */
  label: string;
  icon: IconName;
  /** Shown in the row's tooltip, e.g. the keyboard shortcut. */
  hint?: string;
}

export interface NavSection<Id extends string = string> {
  title: string;
  items: NavItem<Id>[];
}

export interface SidebarProps<Id extends string> {
  /** App name next to the brand mark. */
  name: string;
  sections: NavSection<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** Global controls pinned to the bottom. */
  footer?: ReactNode;
  /** Shows only the icons; the app owns the state. */
  collapsed?: boolean;
  /** With this, a toggle button sits in the footer. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Title of the toggle button (already translated, with its shortcut). */
  toggleLabel?: string;
}

export function Sidebar<Id extends string>(props: SidebarProps<Id>) {
  const { structure, shell } = useLayout();
  if (structure.navPlacement === 'header') return <HeaderNav {...props} />;
  const Shell = shell.Sidebar;
  return <Shell {...props} />;
}

/** Number of line colours a layout can key on (`data-line` 1..LINE_COUNT, cycling through the nav order). */
export const LINE_COUNT = 7;

/** Line of the nav item at flat position `index` (0-based). */
export const lineOf = (index: number) => (index % LINE_COUNT) + 1;

export function BaseSidebar<Id extends string>({ name, sections, current, onSelect, footer: footerProp, collapsed: collapsedProp, onCollapsedChange, toggleLabel }: SidebarProps<Id>) {
  const { structure } = useLayout();
  const collapsed = collapsedProp ?? structure.sidebarMode === 'collapsed';
  const footer = structure.navFooter === 'none' ? undefined : footerProp;
  const ids = sections.flatMap((s) => s.items.map((i) => i.id));
  const currentLine = ids.indexOf(current);
  const currentLabel = sections.flatMap((s) => s.items).find((i) => i.id === current)?.label;
  // Screen hooks on <html> for layouts that style per screen (e.g. a per-screen accent).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.screen = current;
    if (currentLine >= 0) root.dataset.line = String(lineOf(currentLine));
    else delete root.dataset.line;
    if (currentLabel) root.dataset.screenLabel = currentLabel;
    else delete root.dataset.screenLabel;
  }, [current, currentLine, currentLabel]);
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {structure.sidebarBrand && (
        <div className="brand">
          <BrandMark />
          {!collapsed && <span>{name}</span>}
        </div>
      )}
      <div className="side-scroll">
        {sections.map((section) => (
          <div key={section.title} className="side-section">
            {!collapsed && <div className="side-title">{section.title}</div>}
            {section.items.map((item) => {
              const title = item.hint ? `${item.label} (${item.hint})` : item.label;
              return (
                <button
                  key={item.id}
                  className={`side-item${current === item.id ? ' active' : ''}`}
                  data-line={lineOf(ids.indexOf(item.id))}
                  onClick={() => onSelect(item.id)}
                  title={title}
                  {...(collapsed ? { 'aria-label': title } : {})}
                >
                  <Icon name={item.icon} size={14} />
                  {!collapsed && <span className="side-label">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {(footer || onCollapsedChange) && (
        <div className="side-footer">
          {footer}
          {onCollapsedChange && (
            <button className="btn btn-ghost btn-sm side-toggle btn-icon" onClick={() => onCollapsedChange(!collapsed)} title={toggleLabel} aria-label={toggleLabel} aria-pressed={collapsed}>
              <Icon name="sidebar" />
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
