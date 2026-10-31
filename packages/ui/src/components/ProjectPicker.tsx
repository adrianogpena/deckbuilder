import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon, useDialogs } from './ui';

/** What the picker needs of a project. */
export interface PickerProject {
  id: string;
  name: string;
  path: string;
}

export interface ProjectPickerProps<P extends PickerProject = PickerProject> {
  projects: P[];
  current: P | undefined;
  onPick(project: P): void;
  /** Add, edit and remove are listed only when given (the Git screen picks only). */
  onAdd?(): void;
  onEdit?(project: P): void;
  onRemove?(project: P): void;
  /** Drag a project in the dropdown to reorder (pointer based); receives all ids in the new order. Dragging is on only when given. */
  onReorder?(ids: string[]): void;
  /** Extra header buttons on the right. */
  actions?: ReactNode;
}

/** Header of a sidebar tree: the project's name, with a dropdown to switch, add, edit and remove projects. */
export function ProjectPicker<P extends PickerProject>({ projects, current, onPick, onAdd, onEdit, onRemove, onReorder, actions }: ProjectPickerProps<P>) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; over?: string; after?: boolean }>();
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

  const suppressClick = useRef(false);
  const finish = (d: { id: string; over?: string; after?: boolean }) => {
    if (!d.over || d.over === d.id || !onReorder) return;
    const ids = projects.map((p) => p.id).filter((id) => id !== d.id);
    ids.splice(ids.indexOf(d.over) + (d.after ? 1 : 0), 0, d.id);
    if (ids.some((id, i) => id !== projects[i]!.id)) onReorder(ids);
  };
  const startDrag = (e: PointerEvent<HTMLElement>, id: string) => {
    if (!onReorder || projects.length < 2 || e.button !== 0) return;
    const y0 = e.clientY;
    let active = false;
    let last: { id: string; over?: string; after?: boolean } = { id };
    const move = (ev: globalThis.PointerEvent) => {
      if (!active && Math.abs(ev.clientY - y0) < 5) return;
      active = true;
      const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-pid]') ?? []);
      const row = rows.find((r) => ev.clientY < r.getBoundingClientRect().bottom) ?? rows[rows.length - 1];
      if (!row) return;
      const r = row.getBoundingClientRect();
      last = { id, over: row.dataset.pid, after: ev.clientY > r.top + r.height / 2 };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(undefined);
      if (!active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      finish(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const remove = async (project: P) => {
    const ok = await confirm({
      title: t('picker.removeProjectTitle', { name: project.name }),
      body: t('picker.deleteProjectBody', { name: project.name }),
      okLabel: t('picker.delete'),
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
          <span className="xp-picker-name">{current?.name ?? t('picker.addAProject')}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {open && box && createPortal(
          <div ref={list} className="menu xp-picker-menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} style={{ position: 'fixed', right: 'auto', overflowY: 'auto', ...box }}>
            {projects.map((p) => (
              <div
                key={p.id}
                data-pid={p.id}
                className={`xp-picker-row${drag?.over === p.id && drag.id !== p.id ? (drag.after ? ' xp-drop-after' : ' xp-drop-before') : ''}${drag?.id === p.id && drag.over ? ' xp-dragging' : ''}`}
                onPointerDown={(e) => startDrag(e, p.id)}
              >
                <button title={p.name} type="button" className="menu-item" role="menuitemradio" aria-checked={p.id === current?.id} onClick={() => !suppressClick.current && close(() => onPick(p))()}>
                  <span className="menu-icon">{p.id === current?.id && <Icon name="check" size={14} />}</span>
                  <span className="xp-picker-item">
                    <span className="menu-label">{p.name}</span>
                    <span className="xp-picker-path muted">{p.path}</span>
                  </span>
                </button>
              </div>
            ))}
            {projects.length > 0 && onAdd && <div className="menu-sep" />}
            {onAdd && (
              <button title={t('picker.addProjectItem')} type="button" className="menu-item" role="menuitem" onClick={close(onAdd)}>
                <span className="menu-icon"><Icon name="plus" size={14} /></span>
                <span className="menu-label">{t('picker.addProjectItem')}</span>
              </button>
            )}
            {current && onEdit && onRemove && (
              <>
                <button title={t('picker.editProjectItem', { name: current.name })} type="button" className="menu-item" role="menuitem" onClick={close(() => onEdit(current))}>
                  <span className="menu-icon"><Icon name="edit" size={14} /></span>
                  <span className="menu-label">{t('picker.editProjectItem', { name: current.name })}</span>
                </button>
                <button title={t('picker.removeProjectItem', { name: current.name })} type="button" className="menu-item danger" role="menuitem" onClick={close(() => void remove(current))}>
                  <span className="menu-icon"><Icon name="trash" size={14} /></span>
                  <span className="menu-label">{t('picker.removeProjectItem', { name: current.name })}</span>
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
