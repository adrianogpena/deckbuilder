import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ContextMenu } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { sorted, type Meeting } from './model';
import './meeting.css';

export interface MeetingConfig {
  [key: string]: unknown;
}

interface Props {
  config: MeetingConfig;
  data: Meeting | undefined;
  refresh(): void;
}

/** Gives the list the most content-sized columns that fit its width. */
function fitColumns(list: HTMLElement) {
  for (let count = list.children.length; count >= 1; count--) {
    list.style.gridTemplateColumns = `repeat(${count}, max-content)`;
    if (list.scrollWidth <= list.clientWidth) return;
  }
}

export function MeetingPanel({ config, data, refresh }: Props) {
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; name: string } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const namesKey = data ? sorted(data.names).join('|') : '';

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const fit = () => fitColumns(list);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [namesKey, !!data]);

  if (!data) return null;

  const act = async (name: string, payload?: unknown) => {
    try {
      await runAction('meeting', name, config, payload);
    } finally {
      refresh();
    }
  };

  const commitRename = () => {
    if (!editing) return;
    const { name, value } = editing;
    setEditing(null);
    if (value.trim() && value.trim() !== name) void act('rename', { from: name, to: value });
  };

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') setEditing(null);
  };

  const open = (e: MouseEvent, name: string) => {
    e.preventDefault();
    setMenu({ at: { x: e.clientX, y: e.clientY }, name });
  };

  const names = sorted(data.names);

  return (
    <div className="meeting">
      {names.length === 0 && <p className="meeting-empty">{tKey('dash.meeting.empty')}</p>}
      <ul className="meeting-list" ref={listRef}>
        {names.map((n) => (
          <li key={n} className={`meeting-row${data.spoken[n] ? ' spoken' : ''}`} onContextMenu={(e) => open(e, n)}>
            {editing?.name === n ? (
              <input
                type="text"
                autoFocus
                maxLength={60}
                aria-label={tKey('dash.meeting.rename.label', { name: n })}
                value={editing.value}
                onChange={(e) => setEditing({ name: n, value: e.target.value })}
                onKeyDown={onEditKey}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                className="meeting-toggle"
                aria-pressed={!!data.spoken[n]}
                aria-label={tKey('dash.meeting.spoken.label', { name: n })}
                onClick={() => void act('toggle', { name: n })}
                onDoubleClick={() => setEditing({ name: n, value: n })}
              >
                <span className="meeting-name" title={n}>{n}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { id: 'rename', label: tKey('dash.meeting.rename'), icon: 'edit', run: () => setEditing({ name: menu.name, value: menu.name }) },
            { id: 'remove', label: tKey('dash.meeting.remove'), icon: 'trash', danger: true, run: () => void act('remove', { name: menu.name }) },
          ]}
        />
      )}
    </div>
  );
}
