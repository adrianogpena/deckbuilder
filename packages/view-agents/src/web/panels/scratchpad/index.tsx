import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, request } from '@kedalion/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps } from '../../workspace/types';
import './style.css';

const SAVE_DELAY_MS = 600;

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

interface Pad {
  notes: string;
  todos: Todo[];
}

const getPad = (project: string) => request<Pad>('GET', '/api/agents/scratchpad', { project });
const putPad = (project: string, pad: Pad) => request<{ ok: boolean }>('PUT', '/api/agents/scratchpad', { project }, pad);

function ScratchpadBody({ project }: { project: string | undefined }) {
  const [pad, setPad] = useState<Pad | undefined>();
  const [draft, setDraft] = useState('');
  const pending = useRef<{ project: string; pad: Pad }>();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = undefined;
    if (p) void putPad(p.project, p.pad).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPad(undefined);
    if (!project) return;
    let live = true;
    void getPad(project).then((r) => live && setPad(r), () => live && setPad({ notes: '', todos: [] }));
    return () => {
      live = false;
      flush();
    };
  }, [project, flush]);

  const change = (next: Pad) => {
    setPad(next);
    if (!project) return;
    pending.current = { project, pad: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  if (!project) return <p className="agents-empty agents-placeholder">{t('panel.scratchpad.noProject')}</p>;
  if (!pad) return <div className="agents-scratchpad" />;

  const setTodos = (todos: Todo[]) => change({ ...pad, todos });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= pad.todos.length) return;
    const todos = [...pad.todos];
    [todos[i], todos[j]] = [todos[j]!, todos[i]!];
    setTodos(todos);
  };
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setTodos([...pad.todos, { id: crypto.randomUUID(), text, done: false }]);
  };

  return (
    <div className="agents-scratchpad">
      <ul className="agents-scratchpad-todos">
        {pad.todos.map((x, i) => (
          <li key={x.id} className="agents-scratchpad-todo" data-done={x.done}>
            <input
              type="checkbox"
              checked={x.done}
              aria-label={t('panel.scratchpad.done', { text: x.text })}
              onChange={(e) => setTodos(pad.todos.map((y) => (y.id === x.id ? { ...y, done: e.target.checked } : y)))}
            />
            <span className="agents-scratchpad-text">{x.text}</span>
            <IconButton size="xs" icon="arrow-up" label={t('panel.scratchpad.up')} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton size="xs" icon="chevron-down" label={t('panel.scratchpad.down')} disabled={i === pad.todos.length - 1} onClick={() => move(i, 1)} />
            <IconButton size="xs" icon="close" label={t('panel.scratchpad.delete')} onClick={() => setTodos(pad.todos.filter((y) => y.id !== x.id))} />
          </li>
        ))}
      </ul>
      <form
        className="agents-scratchpad-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="agents-scratchpad-input" value={draft} placeholder={t('panel.scratchpad.addPlaceholder')} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" size="sm" disabled={!draft.trim()}>{t('panel.scratchpad.add')}</Button>
      </form>
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'scratchpad',
  titleKey: 'panel.scratchpad.title',
  icon: 'edit',
  placement: 'both',
  single: true,
  Panel: ({ project }: PanelProps) => (
    <div className="agents-panel-scratchpad">
      <ScratchpadBody project={project} />
    </div>
  ),
  Section: ({ project }: SectionProps) => <ScratchpadBody project={project} />,
};
