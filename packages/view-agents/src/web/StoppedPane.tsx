import { useEffect, useState } from 'react';
import type { ChatEvent } from '../chat-protocol.ts';
import { t } from '../i18n';
import { Transcript } from './chat/Transcript';
import { sessionHistory } from './api';

/** Read-only transcript of a session that is not running, with a Start button that resumes it in a terminal. */
export function StoppedPane({ sessionId, updatedAt, onStart }: { sessionId: string; updatedAt: number; onStart(): void }) {
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
        <span>{t('agents.stopped.note')}</span>
        <button type="button" onClick={onStart}>
          {t('agents.stopped.start')}
        </button>
      </div>
      <Transcript events={events} />
    </div>
  );
}
