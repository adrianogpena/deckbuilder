import { useEffect, useState } from 'react';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import { Transcript } from './chat/Transcript';
import { sessionHistory } from './api';

/** Read-only transcript of a session Claude is running in another terminal; "Take over" waits until that process ends. */
export function ExternalPane({ sessionId, updatedAt, external, onTakeOver }: { sessionId: string; updatedAt: number; external: boolean; onTakeOver(): void }) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  useEffect(() => {
    let live = true;
    void sessionHistory(sessionId).then((r) => live && setEvents(r.events), () => undefined);
    return () => {
      live = false;
    };
  }, [sessionId, updatedAt]);
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
