import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@kedalion/ui';
import { t } from '../i18n';
import { getNotes, putNotes } from './api';

const SAVE_DELAY_MS = 600;

export interface NotesTabProps {
  /** Project of the selected session; no project, no notes. */
  project?: string;
  /** A terminal is open for the selected session. */
  canSend: boolean;
  /** Inserts text into the selected session without pressing Enter. */
  onSend(text: string): void;
}

/** Notes tab: a per-project markdown scratchpad, autosaved, whose selection (or whole text) goes to the session. */
export function NotesTab({ project, canSend, onSend }: NotesTabProps) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ project: string; text: string }>();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = undefined;
    if (p) void putNotes(p.project, p.text).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoaded(false);
    setText('');
    if (!project) return;
    let live = true;
    void getNotes(project).then(
      (r) => {
        if (!live) return;
        setText(r.text);
        setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
      flush();
    };
  }, [project, flush]);

  const change = (value: string) => {
    setText(value);
    if (!project) return;
    pending.current = { project, text: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const selected = () => {
    const el = area.current;
    return el && el.selectionEnd > el.selectionStart ? text.slice(el.selectionStart, el.selectionEnd) : '';
  };
  const send = () => {
    const out = selected() || text;
    if (out.trim()) onSend(out);
  };

  if (!project) return <p className="agents-empty agents-placeholder">{t('agents.panel.notes.empty')}</p>;
  return (
    <div className="agents-notes">
      <textarea
        ref={area}
        className="agents-notes-text"
        value={text}
        disabled={!loaded}
        placeholder={t('agents.notes.placeholder')}
        aria-label={t('agents.notes.label')}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onSelect={() => setHasSelection(selected() !== '')}
        onBlur={flush}
      />
      <div className="agents-notes-actions">
        <Button variant="primary" size="sm" icon="send" disabled={!canSend || !loaded || (!hasSelection && !text.trim())} title={t('agents.notes.send.hint')} onMouseDown={(e) => e.preventDefault()} onClick={send}>
          {t('agents.notes.send')}
        </Button>
      </div>
    </div>
  );
}
