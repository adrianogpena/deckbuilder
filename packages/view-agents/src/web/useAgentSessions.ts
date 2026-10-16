import { useEffect, useState } from 'react';
import { type AgentSessionView, listAgentSessions, openAgentsSocket } from './api';

/** Sessions with live status: initial fetch, then socket frames; reconnects after a drop. */
export function useAgentSessions(): AgentSessionView[] {
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  useEffect(() => {
    let alive = true;
    let close: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => listAgentSessions().then((s) => alive && setSessions(s)).catch(() => {});
    const connect = async () => {
      try {
        close = await openAgentsSocket((f) => {
          if (f.type === 'sessions') setSessions(f.sessions);
          else if (f.type === 'status') setSessions((cur) => cur.map((s) => (f.status[s.id] ? { ...s, status: f.status[s.id] } : s)));
        });
      } catch {
        if (alive) timer = setTimeout(connect, 5000);
      }
    };
    void load();
    void connect();
    return () => { alive = false; close?.(); if (timer) clearTimeout(timer); };
  }, []);
  return sessions;
}
