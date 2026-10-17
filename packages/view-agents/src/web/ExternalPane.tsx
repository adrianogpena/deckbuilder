import { useEffect, useMemo, useState } from 'react';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import { Transcript } from './chat/Transcript';
import { onTail, reportPreview, type TailTurn } from './api';

/** Read-only transcript of a session Claude is running in another terminal, followed live; "Take over" waits until that process ends. */
export function ExternalPane({ sessionId, external, onTakeOver }: { sessionId: string; updatedAt?: number; external: boolean; onTakeOver(): void }) {
  const [turns, setTurns] = useState<TailTurn[]>([]);
  useEffect(() => {
    setTurns([]);
    const off = onTail((id, next) => id === sessionId && setTurns(next));
    void reportPreview(sessionId).catch(() => undefined);
    return () => {
      off();
      void reportPreview(null).catch(() => undefined);
    };
  }, [sessionId]);
  const events = useMemo<ChatEvent[]>(() => turns.map((x) => (x.role === 'user' ? { type: 'user', text: x.text } : { type: 'text', text: x.text })), [turns]);
  return (
    <div className="agents-external">
      <div className="agents-external-bar">
        <span>{t('agents.external.note')}</span>
        <button type="button" disabled={external} title={external ? t('agents.external.takeoverHint') : undefined} onClick={onTakeOver}>
          {t('agents.external.takeover')}
        </button>
      </div>
      <Transcript events={events} />
    </div>
  );
}
