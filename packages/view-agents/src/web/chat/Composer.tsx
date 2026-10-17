import { useEffect, useRef, useState } from 'react';
import type { QueuedMessage } from '../../chat-protocol.ts';
import { t } from '../../i18n';

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  queue: QueuedMessage[];
  onSend(text: string): void;
  onInterrupt(): void;
  onEditQueued(id: string, text: string): void;
  onRemoveQueued(id: string): void;
  /** Gets a function that appends text to the draft (null when unmounted). */
  insertRef?(insert: ((text: string) => void) | null): void;
}

function QueuedRow({ item, onEdit, onRemove }: { item: QueuedMessage; onEdit(text: string): void; onRemove(): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const save = () => { if (draft.trim()) onEdit(draft); setDraft(null); };
    return (
      <li className="chat-queued editing">
        <textarea
          value={draft}
          autoFocus
          rows={2}
          aria-label={t('agents.chat.queue.edit')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
            else if (e.key === 'Escape') setDraft(null);
          }}
        />
        <button type="button" onClick={save}>{t('agents.chat.queue.save')}</button>
        <button type="button" onClick={() => setDraft(null)}>{t('agents.new.cancel')}</button>
      </li>
    );
  }
  return (
    <li className="chat-queued">
      <span className="chat-queued-tag">{t('agents.chat.queued')}</span>
      <span className="chat-queued-text">{item.text}</span>
      <button type="button" className="chat-icon" title={t('agents.chat.queue.edit')} aria-label={t('agents.chat.queue.edit')} onClick={() => setDraft(item.text)}>✎</button>
      <button type="button" className="chat-icon" title={t('agents.chat.queue.remove')} aria-label={t('agents.chat.queue.remove')} onClick={onRemove}>x</button>
    </li>
  );
}

/** Message box: Enter sends (Shift+Enter for a new line). While a turn runs, sends are queued and shown above it. */
export function Composer({ running, disabled, queue, onSend, onInterrupt, onEditQueued, onRemoveQueued, insertRef }: ComposerProps) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    insertRef?.((add) => {
      setText((cur) => (cur && !cur.endsWith('\n') ? `${cur}\n${add}` : cur + add));
      area.current?.focus();
    });
    return () => insertRef?.(null);
  }, [insertRef]);
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  return (
    <div className="chat-composer">
      {queue.length > 0 && (
        <ul className="chat-queue" aria-label={t('agents.chat.queue')}>
          {queue.map((q) => (
            <QueuedRow key={q.id} item={q} onEdit={(v) => onEditQueued(q.id, v)} onRemove={() => onRemoveQueued(q.id)} />
          ))}
        </ul>
      )}
      <div className="chat-input">
        <textarea
          ref={area}
          value={text}
          rows={3}
          placeholder={running ? t('agents.chat.placeholder.queue') : t('agents.chat.placeholder')}
          aria-label={t('agents.chat.message')}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            else if (e.key === 'Escape' && running) { e.preventDefault(); onInterrupt(); }
          }}
        />
        <div className="chat-actions">
          {running && <button type="button" className="chat-interrupt" onClick={onInterrupt} title={t('agents.chat.interrupt.hint')}>{t('agents.chat.interrupt')}</button>}
          <button type="button" className="primary" disabled={disabled || !text.trim()} onClick={submit}>
            {running ? t('agents.chat.queueSend') : t('agents.chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
