import type { ReactNode } from 'react';
import { APP } from '../../../shared/app';
import { t, type MessageKey } from '../i18n';
import type { ScreenId } from '../route';
import { BrandMark, Icon } from './ui';

export interface NavItem {
  id: ScreenId;
  label: MessageKey;
  icon: string;
  /** Short hint on the right, e.g. the keyboard shortcut. */
  hint?: string;
}

export interface NavSection {
  title: MessageKey;
  items: NavItem[];
}

interface Props {
  sections: NavSection[];
  current: ScreenId;
  onSelect: (id: ScreenId) => void;
  /** Global controls pinned to the bottom. */
  footer?: ReactNode;
}

export function Sidebar({ sections, current, onSelect, footer }: Props) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <BrandMark />
        <span>{APP.name}</span>
      </div>
      <div className="side-scroll">
        {sections.map((section) => (
          <div key={section.title} className="side-section">
            <div className="side-title">{t(section.title)}</div>
            {section.items.map((item) => (
              <button key={item.id} className={`side-item${current === item.id ? ' active' : ''}`} onClick={() => onSelect(item.id)}>
                <Icon name={item.icon} size={14} />
                <span className="side-label">{t(item.label)}</span>
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
