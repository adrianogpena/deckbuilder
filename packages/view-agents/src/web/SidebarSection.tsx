import { type DragEvent, type MouseEvent, type ReactNode, useState } from 'react';
import { Icon, IconButton, type IconName, useShortcutTip } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { SectionId } from './sidebar-sections';

/** Drag type of a section header, so tree drags never land on headers and the reverse. */
export const SECTION_DRAG_TYPE = 'application/x-agents-section';

/** One icon button in a section header; hidden until the header is hovered or focused, unless pressed. */
export function SectionButton({ icon, label, onClick, pressed, command }: { icon: IconName; label: string; onClick(): void; pressed?: boolean; command?: string }) {
  const tip = useShortcutTip();
  return (
    <IconButton
      size="xs"
      icon={icon}
      label={label}
      className="agents-section-btn"
      title={tip(label, command)}
      pressed={pressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    />
  );
}

export interface SidebarSectionProps {
  id: SectionId;
  title: string;
  count?: number;
  /** Extra text after the count (e.g. the filter note). */
  note?: ReactNode;
  collapsed: boolean;
  onToggle(): void;
  onHide(): void;
  /** Header actions before the × (SectionButton). */
  actions?: ReactNode;
  /** The id of the section being dragged, if any. */
  dragging?: SectionId;
  onDragStart(id: SectionId): void;
  onDragEnd(): void;
  /** Drop of the dragged section before (`after` false) or after this one. */
  onDrop(target: SectionId, after: boolean): void;
  onMenu(e: MouseEvent): void;
  className?: string;
  children?: ReactNode;
}

/** A sidebar card (spec S5): 30px header with chevron, mono title, count, hover actions and ×; drag the header to reorder. */
export function SidebarSection({ id, title, count, note, collapsed, onToggle, onHide, actions, dragging, onDragStart, onDragEnd, onDrop, onMenu, className, children }: SidebarSectionProps) {
  const [drop, setDrop] = useState<'before' | 'after'>();
  const over = (e: DragEvent) => {
    if (!dragging || dragging === id || !e.dataTransfer.types.includes(SECTION_DRAG_TYPE)) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setDrop(e.clientY > box.top + box.height / 2 ? 'after' : 'before');
  };
  const toggleLabel = collapsed ? t('agents.section.expand') : t('agents.section.collapse');
  return (
    <section
      className={`agents-section${collapsed ? ' collapsed' : ''}${dragging === id ? ' dragging' : ''}${drop ? ` drop-${drop}` : ''}${className ? ` ${className}` : ''}`}
      data-section={id}
      aria-label={title}
      onDragOver={over}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(undefined);
      }}
      onDrop={(e) => {
        const at = drop;
        setDrop(undefined);
        if (!at || !dragging || dragging === id) return;
        e.preventDefault();
        onDrop(id, at === 'after');
      }}
    >
      <div
        className="agents-section-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(SECTION_DRAG_TYPE, id);
          onDragStart(id);
        }}
        onDragEnd={() => {
          setDrop(undefined);
          onDragEnd();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e);
        }}
      >
        <button type="button" className="agents-section-toggle" aria-expanded={!collapsed} title={toggleLabel} onClick={onToggle}>
          <span className="agents-section-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span>
          <span className="agents-label">{title}</span>
          {count !== undefined && <span className="agents-section-count">{count}</span>}
          {note}
        </button>
        <span className="agents-section-actions">
          {actions}
          <SectionButton icon="close" label={t('agents.section.hide')} onClick={onHide} />
        </span>
      </div>
      {!collapsed && <div className="agents-section-body">{children}</div>}
    </section>
  );
}
