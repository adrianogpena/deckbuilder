import { useEffect, useState } from 'react';
import type { ChatEvent } from '../chat-protocol.ts';
import { Transcript } from './chat/Transcript';
import { sessionHistory } from './api';
import { StoppedCard, type StoppedCardProps } from './StoppedCard';

/** A session that is not attached: the stopped-session card, then its read-only transcript. */
export function StoppedPane(props: StoppedCardProps) {
  const { id: sessionId, updatedAt } = props.session;
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
      <StoppedCard {...props} />
      <Transcript events={events} />
    </div>
  );
}
