import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useDialogs } from '@deckbuilder/ui';
import type { Project } from '../../api';
import { t } from '../../i18n';

export interface ProjectPickerProps {
  projects: Project[];
  current: Project | undefined;
  onPick(project: Project): void;
  /** Add, edit and remove are listed only when given (the Git screen picks only). */
  onAdd?(): void;
  onEdit?(project: Project): void;
  onRemove?(project: Project): void;
  /** Extra header buttons on the right. */
  actions?: ReactNode;
}

/** Header of a sidebar tree: the project's name, with a dropdown to switch, add, edit and remove projects. */
export function ProjectPicker({ projects, current, onPick, onAdd, onEdit, onRemove, actions }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { confirm, element } = useDialogs();

  const [box, setBox] = useState<{ top: number; left: number; minWidth: number; maxHeight: number }>();
  useEffect(() => {
    if (!open || !wrap.current) return setBox(undefined);
    const r = wrap.current.getBoundingClientRect();
    setBox({ top: r.bottom + 4, left: r.left, minWidth: Math.max(r.width, 260), maxHeight: Math.max(120, window.innerHeight - r.bottom - 12) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const at = e.target as Node;
      if (!wrap.current?.contains(at) && !list.current?.contains(at)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = (act: () => void) => () => {
    setOpen(false);
    act();
  };

  const remove = async (project: Project) => {
    const ok = await confirm({
      title: t('explorer.removeProjectTitle', { name: project.name }),
      body: t('explorer.deleteProjectBody', { name: project.name }),
      okLabel: t('explorer.delete'),
      danger: true,
    });
    if (ok) onRemove?.(project);
  };

  return (
    <div className="xp-picker">
      {element}
      <div className="menu-wrap xp-picker-wrap" ref={wrap} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        <button
          type="button"
          className="xp-picker-button"
          title={current?.path}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => (current || projects.length > 0 ? setOpen(!open) : onAdd?.())}
        >
          <Icon name="folder" size={14} />
          <span className="xp-picker-name">{current?.name ?? t('explorer.addAProject')}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {open && box && createPortal(
          <div ref={list} className="menu xp-picker-menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} style={{ position: 'fixed', right: 'auto', overflowY: 'auto', ...box }}>
            {projects.map((p) => (
              <button key={p.id} type="button" className="menu-item" role="menuitemradio" aria-checked={p.id === current?.id} onClick={close(() => onPick(p))}>
                <span className="menu-icon">{p.id === current?.id && <Icon name="check" size={14} />}</span>
                <span className="xp-picker-item">
                  <span className="menu-label">{p.name}</span>
                  <span className="xp-picker-path muted">{p.path}</span>
                </span>
              </button>
            ))}
            {projects.length > 0 && onAdd && <div className="menu-sep" />}
            {onAdd && (
              <button type="button" className="menu-item" role="menuitem" onClick={close(onAdd)}>
                <span className="menu-icon"><Icon name="plus" size={14} /></span>
                <span className="menu-label">{t('explorer.addProjectItem')}</span>
              </button>
            )}
            {current && onEdit && onRemove && (
              <>
                <button type="button" className="menu-item" role="menuitem" onClick={close(() => onEdit(current))}>
                  <span className="menu-icon"><Icon name="edit" size={14} /></span>
                  <span className="menu-label">{t('explorer.editProjectItem', { name: current.name })}</span>
                </button>
                <button type="button" className="menu-item danger" role="menuitem" onClick={close(() => void remove(current))}>
                  <span className="menu-icon"><Icon name="trash" size={14} /></span>
                  <span className="menu-label">{t('explorer.removeProjectItem', { name: current.name })}</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
      </div>
      {actions && <div className="xp-picker-actions">{actions}</div>}
    </div>
  );
}
