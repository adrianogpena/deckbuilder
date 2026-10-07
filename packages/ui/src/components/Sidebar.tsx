import type { ReactNode } from 'react';
import { BrandMark, Icon } from './ui';

export interface NavItem<Id extends string = string> {
  id: Id;
  /** Display text (already translated). */
  label: string;
  icon: string;
  /** Short hint on the right, e.g. the keyboard shortcut. */
  hint?: string;
}

export interface NavSection<Id extends string = string> {
  title: string;
  items: NavItem<Id>[];
}

interface Props<Id extends string> {
  /** App name next to the brand mark. */
  name: string;
  sections: NavSection<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** Global controls pinned to the bottom. */
  footer?: ReactNode;
}

export function Sidebar<Id extends string>({ name, sections, current, onSelect, footer }: Props<Id>) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <BrandMark />
        <span>{name}</span>
      </div>
      <div className="side-scroll">
        {sections.map((section) => (
          <div key={section.title} className="side-section">
            <div className="side-title">{section.title}</div>
            {section.items.map((item) => (
              <button key={item.id} className={`side-item${current === item.id ? ' active' : ''}`} onClick={() => onSelect(item.id)}>
                <Icon name={item.icon} size={14} />
                <span className="side-label">{item.label}</span>
                {item.hint && <span className="side-short">{item.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      {footer && <div className="side-footer">{footer}</div>}
    </nav>
  );
}
