import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, ContextMenu, IconButton } from '@deckbuilderkit/ui';
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

export function MeetingPanel({ config, data, refresh }: Props) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; name: string } | null>(null);

  if (!data) return null;

  const act = async (name: string, payload?: unknown) => {
    try {
      await runAction('meeting', name, config, payload);
    } finally {
      refresh();
    }
  };

  const submitAdd = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft('');
    void act('add', { name });
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
  const spoken = names.filter((n) => data.spoken[n]).length;

  return (
    <div className="meeting">
      <div className="meeting-head">
        <span>{tKey('dash.meeting.count', { spoken, total: names.length })}</span>
        <Button onClick={() => void act('reset')}>{tKey('dash.meeting.reset')}</Button>
      </div>
      {names.length === 0 && <p className="meeting-empty">{tKey('dash.meeting.empty')}</p>}
      <ul className="meeting-list">
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
              <label onDoubleClick={() => setEditing({ name: n, value: n })}>
                <input type="checkbox" checked={!!data.spoken[n]} aria-label={tKey('dash.meeting.spoken.label', { name: n })} onChange={() => void act('toggle', { name: n })} />
                <span className="meeting-name" title={n}>{n}</span>
              </label>
            )}
            <IconButton icon="more" label={tKey('dash.meeting.more', { name: n })} onClick={(e) => open(e, n)} />
          </li>
        ))}
      </ul>
      <div className="meeting-add">
        <input
          type="text"
          maxLength={60}
          placeholder={tKey('dash.meeting.add.placeholder')}
          aria-label={tKey('dash.meeting.add.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
        />
        <Button onClick={submitAdd}>{tKey('dash.meeting.add')}</Button>
      </div>
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
