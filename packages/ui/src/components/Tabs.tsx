import { useRef } from 'react';
import { useRovingList } from '../roving-list';

export interface TabsItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabsItem[];
  active: string;
  onChange: (id: string) => void;
  /** Prefix of the element ids (`<idPrefix>-tab-<id>`), for `aria-labelledby` on the panel. */
  idPrefix?: string;
}

/** Tab bar: 2px accent underline on the active tab, arrow keys move between tabs. */
export function Tabs({ tabs, active, onChange, idPrefix = 'tabs' }: TabsProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingList(ref, '.tabs-tab');
  return (
    <div ref={ref} className="tabs" role="tablist" onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = tabs.findIndex((tab) => tab.id === active);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      e.preventDefault();
      onChange(next.id);
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus());
    }}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`} data-tab={tab.id}
          className={`tabs-tab${tab.id === active ? ' active' : ''}`} aria-selected={tab.id === active}
          aria-controls={`${idPrefix}-panel-${tab.id}`} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
