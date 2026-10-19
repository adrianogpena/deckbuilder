import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '@deckbuilderkit/ui';
import {
  CHAT_SOCKET_PATH,
  type ChatClientFrame,
  type ChatEvent,
  type ChatOpenFrame,
  type ChatServerFrame,
  type ChatState,
  type PermissionDecision,
  type PermissionMode,
} from '../../chat-protocol.ts';
import { t, type AgentsMessageKey } from '../../i18n';
import { applyEvent } from './chat-model';

export interface ChatTarget {
  /** Opens an existing Claude session. */
  sessionId?: string;
  /** Starts a new chat in this folder (when `sessionId` is absent). */
  cwd?: string;
  accountId?: string;
  permissionMode?: PermissionMode;
  model?: string;
}

export interface ChatOpened {
  sessionId?: string;
  cwd: string;
  accountId: string;
  model?: string;
}

export interface ChatError {
  code: string;
  message: string;
}

const ERROR_KEYS: Record<string, AgentsMessageKey> = {
  badCwd: 'agents.chat.error.badCwd',
  noAccount: 'agents.chat.error.noAccount',
  sessionNotFound: 'agents.chat.error.sessionNotFound',
  noCwd: 'agents.chat.error.noCwd',
  badFrame: 'agents.chat.error.badFrame',
  notOpen: 'agents.chat.error.notOpen',
  alreadyOpen: 'agents.chat.error.alreadyOpen',
};

/** The translated message of a chat error frame (server text for unknown codes). */
export function chatErrorText(e: ChatError): string {
  const key = ERROR_KEYS[e.code];
  return key ? t(key) : e.message;
}

/** Most transcript events kept; older ones drop off the front (a tool result whose use dropped shows as an orphan). */
const MAX_EVENTS = 5000;

const capEvents = (events: ChatEvent[]): ChatEvent[] => (events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events);

/** Opens a chat socket for `target` and keeps its transcript and state. Reopens when the target changes. */
export function useChat(target: ChatTarget, onSession?: (sessionId: string) => void) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [state, setState] = useState<ChatState | null>(null);
  const [opened, setOpened] = useState<ChatOpened | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const sessionCb = useRef(onSession);
  sessionCb.current = onSession;
  const { sessionId, cwd, accountId, permissionMode, model } = target;

  useEffect(() => {
    let closed = false;
    setEvents([]);
    setState(null);
    setOpened(null);
    setError(null);
    setConnected(false);
    (async () => {
      let ticket: string;
      try {
        ({ ticket } = await request<{ ticket: string }>('POST', '/api/agents/chat/socket-ticket'));
      } catch (e) {
        if (!closed) setError({ code: 'connect', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${location.host}${CHAT_SOCKET_PATH}?t=${encodeURIComponent(ticket)}`);
      ws.current = sock;
      sock.onopen = () => {
        const open: ChatOpenFrame = sessionId
          ? { type: 'open', sessionId, permissionMode, model }
          : { type: 'open', cwd, accountId, permissionMode, model };
        sock.send(JSON.stringify(open));
        setConnected(true);
      };
      sock.onclose = () => { if (!closed) setConnected(false); };
      sock.onmessage = (m) => {
        let f: ChatServerFrame;
        try { f = JSON.parse(String(m.data)); } catch { return; }
        switch (f.type) {
          case 'opened':
            setOpened({ sessionId: f.sessionId, cwd: f.cwd, accountId: f.accountId, model: f.model });
            if (f.sessionId) sessionCb.current?.(f.sessionId);
            break;
          case 'history':
            setEvents((prev) => capEvents(f.events.reduce(applyEvent, [] as ChatEvent[]).concat(prev)));
            break;
          case 'event':
            setEvents((prev) => capEvents(applyEvent(prev, f.event)));
            if (f.event.type === 'init') sessionCb.current?.(f.event.sessionId);
            break;
          case 'state': {
            const { type: _, ...s } = f;
            setState(s);
            break;
          }
          case 'error':
            setError({ code: f.code, message: f.message });
            break;
        }
      };
    })();
    return () => {
      closed = true;
      ws.current?.close();
      ws.current = null;
    };
  }, [sessionId, cwd, accountId, permissionMode, model]);

  const send = useCallback((frame: ChatClientFrame) => {
    const sock = ws.current;
    if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify(frame));
  }, []);

  return {
    events,
    state,
    opened,
    error,
    connected,
    clearError: () => setError(null),
    sendText: (text: string) => send({ type: 'send', text }),
    editQueued: (id: string, text: string) => send({ type: 'queue-edit', id, text }),
    removeQueued: (id: string) => send({ type: 'queue-remove', id }),
    interrupt: () => send({ type: 'interrupt' }),
    answer: (requestId: string, decision: PermissionDecision) => send({ type: 'permission', requestId, decision }),
  };
}
