import { useEffect, useRef, useState } from 'react';
import { Button, ContextMenu, IconButton } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { clockText, MAX_LABEL, MAX_SNIPPET, MAX_SCRATCH, MAX_TODO, type Daily } from './model';
import './daily.css';

interface Props {
  config: Record<string, unknown>;
  data: Daily | undefined;
  refresh(): void;
}

const useAct = (source: string, config: Record<string, unknown>, refresh: () => void) => async (name: string, payload?: unknown) => {
  try {
    await runAction(source, name, config, payload);
  } finally {
    refresh();
  }
};

export function TodoPanel({ config, data, refresh }: Props) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; id: string; text: string } | null>(null);
  const act = useAct('todo', config, refresh);
  if (!data) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void act('add', { text });
  };
  const commit = () => {
    if (!editing) return;
    const { id, value } = editing;
    setEditing(null);
    if (value.trim()) void act('edit', { id, text: value });
  };
  const done = data.todos.filter((t) => t.done).length;

  return (
    <div className="daily">
      <div className="daily-head">
        <span>{tKey('dash.daily.todo.count', { done, total: data.todos.length })}</span>
        <Button onClick={() => void act('clear-done')} disabled={done === 0}>{tKey('dash.daily.todo.clear')}</Button>
      </div>
      {data.todos.length === 0 && <p className="daily-empty">{tKey('dash.daily.todo.empty')}</p>}
      <ul className="daily-list">
        {data.todos.map((t) => (
          <li
            key={t.id}
            className={`daily-row${t.done ? ' done' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ at: { x: e.clientX, y: e.clientY }, id: t.id, text: t.text });
            }}
          >
            <input type="checkbox" checked={t.done} aria-label={tKey('dash.daily.todo.check', { text: t.text })} onChange={() => void act('toggle', { id: t.id })} />
            {editing?.id === t.id ? (
              <input
                type="text"
                autoFocus
                maxLength={MAX_TODO}
                value={editing.value}
                aria-label={t.text}
                onChange={(e) => setEditing({ id: t.id, value: e.target.value })}
                onKeyDown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && setEditing(null))}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <span className="daily-text" title={t.text} onDoubleClick={() => setEditing({ id: t.id, value: t.text })}>{t.text}</span>
            )}
            <IconButton icon="trash" label={tKey('dash.daily.todo.remove', { text: t.text })} onClick={() => void act('remove', { id: t.id })} />
          </li>
        ))}
      </ul>
      <div className="daily-add">
        <input
          type="text"
          maxLength={MAX_TODO}
          placeholder={tKey('dash.daily.todo.add')}
          aria-label={tKey('dash.daily.todo.add')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button onClick={submit}>{tKey('dash.meeting.add')}</Button>
      </div>
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            { id: 'rename', label: tKey('dash.meeting.rename'), icon: 'edit', run: () => setEditing({ id: menu.id, value: menu.text }) },
            { id: 'remove', label: tKey('dash.meeting.remove'), icon: 'trash', danger: true, run: () => void act('remove', { id: menu.id }) },
          ]}
        />
      )}
    </div>
  );
}

export function ScratchpadPanel({ config, data }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<number>();
  const latest = useRef('');

  const flush = async () => {
    window.clearTimeout(timer.current);
    try {
      await runAction('scratchpad', 'save', config, { text: latest.current });
    } finally {
      setSaved(true);
    }
  };
  useEffect(() => () => {
    if (timer.current) void runAction('scratchpad', 'save', config, { text: latest.current });
    window.clearTimeout(timer.current);
  }, []);
  if (!data) return null;

  const value = text ?? data.scratch;
  const change = (next: string) => {
    latest.current = next;
    setText(next);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 600);
  };

  return (
    <div className="daily">
      <textarea
        className="daily-scratch"
        maxLength={MAX_SCRATCH}
        value={value}
        placeholder={tKey('dash.daily.scratch.placeholder')}
        aria-label={tKey('dash.daily.scratch')}
        onChange={(e) => change(e.target.value)}
        onBlur={() => !saved && void flush()}
      />
      <div className="daily-head"><span>{tKey(saved ? 'dash.daily.scratch.saved' : 'dash.daily.scratch.saving')}</span></div>
    </div>
  );
}

export function SnippetsPanel({ config, data, refresh }: Props) {
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState('');
  const act = useAct('snippets', config, refresh);
  if (!data) return null;

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };
  const submit = () => {
    if (!label.trim() || !text.trim()) return;
    void act('add', { label, text });
    setLabel('');
    setText('');
  };

  return (
    <div className="daily">
      {data.snippets.length === 0 && <p className="daily-empty">{tKey('dash.daily.snippets.empty')}</p>}
      <ul className="daily-list">
        {data.snippets.map((s) => (
          <li key={s.id} className="daily-row">
            <Button className="daily-text" title={s.text} aria-label={tKey('dash.daily.snippets.copy', { label: s.label })} onClick={() => void copy(s.id, s.text)}>
              {copied === s.id ? tKey('dash.daily.snippets.copied') : s.label}
            </Button>
            <IconButton icon="trash" label={tKey('dash.daily.snippets.remove', { label: s.label })} onClick={() => void act('remove', { id: s.id })} />
          </li>
        ))}
      </ul>
      <div className="daily-add">
        <input type="text" maxLength={MAX_LABEL} placeholder={tKey('dash.daily.snippets.label')} aria-label={tKey('dash.daily.snippets.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          type="text"
          maxLength={MAX_SNIPPET}
          placeholder={tKey('dash.daily.snippets.text')}
          aria-label={tKey('dash.daily.snippets.text')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <Button onClick={submit}>{tKey('dash.daily.snippets.add')}</Button>
      </div>
    </div>
  );
}

const PRESETS = [5, 15, 25, 50];
const STORE = 'kedalion.focus-timer';

interface TimerState {
  total: number;
  /** Remaining ms while paused. */
  left: number;
  /** Epoch ms when it ends, while running. */
  endsAt: number | null;
}

const readTimer = (): TimerState => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<TimerState> | null;
    if (raw && typeof raw.total === 'number' && typeof raw.left === 'number') return { total: raw.total, left: raw.left, endsAt: typeof raw.endsAt === 'number' ? raw.endsAt : null };
  } catch {
    /* storage unavailable */
  }
  return { total: 25 * 60_000, left: 25 * 60_000, endsAt: null };
};

export function FocusTimerPanel() {
  const [state, setState] = useState<TimerState>(readTimer);
  const [now, setNow] = useState(() => Date.now());

  const save = (next: TimerState) => {
    setState(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const running = state.endsAt !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  const left = state.endsAt === null ? state.left : Math.max(0, state.endsAt - now);
  const over = running && left === 0;
  useEffect(() => {
    if (!over) return;
    save({ ...state, left: 0, endsAt: null });
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(tKey('dash.daily.timer.done'));
    } catch {
      /* notifications unavailable */
    }
  }, [over]);

  const start = () => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    const ms = left > 0 ? left : state.total;
    setNow(Date.now());
    save({ ...state, left: ms, endsAt: Date.now() + ms });
  };
  const pause = () => save({ ...state, left, endsAt: null });
  const reset = (total = state.total) => save({ total, left: total, endsAt: null });

  return (
    <div className="daily daily-timer">
      <div className={`daily-timer-time${left === 0 ? ' over' : ''}`} aria-live="off">{clockText(left)}</div>
      {left === 0 && <p className="daily-empty">{tKey('dash.daily.timer.done')}</p>}
      <div className="daily-timer-actions">
        {running ? <Button onClick={pause}>{tKey('dash.daily.timer.pause')}</Button> : <Button variant="primary" onClick={start}>{tKey('dash.daily.timer.start')}</Button>}
        <Button onClick={() => reset()}>{tKey('dash.daily.timer.reset')}</Button>
      </div>
      <div className="daily-timer-presets">
        {PRESETS.map((m) => (
          <Button key={m} size="sm" onClick={() => reset(m * 60_000)}>{tKey('dash.daily.timer.minutes', { n: m })}</Button>
        ))}
      </div>
    </div>
  );
}
