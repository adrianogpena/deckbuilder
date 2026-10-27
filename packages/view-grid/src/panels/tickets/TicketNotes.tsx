import { CodeEditor } from '@kedalion/editor';
import { useEffect, useRef, useState } from 'react';
import { runAction } from '../../source';
import './tickets.css';

interface Props {
  ticketId: string;
  config: Record<string, unknown>;
}

const SAVE_DELAY_MS = 600;

/** The ticket's notes in the side panel: always markdown source, saved as you type. */
export function TicketNotes({ ticketId, config }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const latest = useRef('');
  const saved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const configRef = useRef(config);
  configRef.current = config;

  const flush = async () => {
    clearTimeout(timer.current);
    const value = latest.current;
    if (saved.current === null || value === saved.current) return;
    saved.current = value;
    try {
      await runAction('tickets', 'notes-set', configRef.current, { id: ticketId, text: value });
      setError('');
    } catch (err) {
      saved.current = null;
      setError(String((err as Error)?.message ?? err));
    }
  };

  useEffect(() => {
    let live = true;
    runAction<string>('tickets', 'notes-get', configRef.current, { id: ticketId })
      .then((value) => {
        if (!live) return;
        latest.current = value;
        saved.current = value;
        setText(value);
      })
      .catch((err) => live && setError(String((err as Error)?.message ?? err)));
    return () => {
      live = false;
      void flush();
    };
  }, [ticketId]);

  if (text === null) return error ? <div className="tickets-error" role="alert">{error}</div> : null;
  return (
    <div className="tickets-notes">
      {error && <div className="tickets-error" role="alert">{error}</div>}
      <CodeEditor
        value={text}
        lang="markdown"
        height="100%"
        wrap
        onChange={(value) => {
          latest.current = value;
          if (saved.current === null) saved.current = '';
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        }}
      />
    </div>
  );
}
