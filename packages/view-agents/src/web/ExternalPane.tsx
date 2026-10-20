import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Transcript } from './chat/Transcript';
import { onTail, reportPreview, type TailEvent } from './api';

/** Read-only transcript of a session Claude is running in another terminal, followed live; "Take over" waits until that process ends. */
export function ExternalPane({ sessionId, external, hanging, onTakeOver }: { sessionId: string; updatedAt?: number; external: boolean; hanging?: boolean; onTakeOver(): void }) {
  const [events, setEvents] = useState<TailEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    const off = onTail((id, next) => id === sessionId && setEvents(next));
    void reportPreview(sessionId).catch(() => undefined);
    return () => {
      off();
      void reportPreview(null).catch(() => undefined);
    };
  }, [sessionId]);
  return (
    <div className="agents-external">
      <div className="agents-external-bar">
        <span>{hanging ? t('agents.hanging.note') : t('agents.external.note')}</span>
        <button type="button" title={hanging ? t('agents.hanging.closeHint') : external ? t('agents.external.takeoverHint') : t('agents.external.takeover')} onClick={onTakeOver}>
          {hanging ? t('agents.hanging.close') : t('agents.external.takeover')}
        </button>
      </div>
      <Transcript events={events} />
    </div>
  );
}
