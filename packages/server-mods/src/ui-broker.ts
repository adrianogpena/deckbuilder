import { randomUUID } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { type Routes, type SocketData, type SocketRoutes, socketTickets } from '@kedalion/server-core';

export const UI_SOCKET_PATH = '/api/ui/socket';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirm button. */
  ok?: string;
  /** i18n key of the confirm button label, resolved by the page. */
  okKey?: string;
  danger?: boolean;
}

/** Server → page. */
export type UiFrame = { type: 'confirm'; id: string } & ConfirmOptions;
/** Page → server. */
export type UiAnswer = { type: 'answer'; id: string; ok: boolean };

export interface UiBroker {
  sockets: SocketRoutes;
  /** `POST /api/ui/socket-ticket[?popout=1]` → `{ ticket }`. */
  routes: Routes;
  /** Asks the newest page (a non-pop-out one first) and resolves with its answer; false when none answers. */
  confirm(o: ConfirmOptions): Promise<boolean>;
  /** What brings a window up when no page is connected. */
  setReveal(fn: () => void | Promise<void>): void;
  connected(): number;
}

type Ws = ServerWebSocket<SocketData>;

interface Pending {
  frame: UiFrame;
  resolve(ok: boolean): void;
  ws: Ws | null;
  timer?: ReturnType<typeof setTimeout>;
}

/** Lets the server ask the open page a question (a confirm dialog) over a WebSocket. */
export function uiBroker(opts: { connectTimeoutMs?: number } = {}): UiBroker {
  const timeoutMs = opts.connectTimeoutMs ?? 10_000;
  const tickets = socketTickets<{ popout: boolean }>();
  const conns: Array<{ ws: Ws; popout: boolean }> = [];
  const pending = new Map<string, Pending>();
  let reveal: () => void | Promise<void> = () => {};

  const pick = (): Ws | null => {
    const main = conns.findLast((c) => !c.popout);
    return (main ?? conns.at(-1))?.ws ?? null;
  };

  const settle = (id: string, ok: boolean) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(ok);
  };

  const dispatch = (p: Pending, ws: Ws) => {
    p.ws = ws;
    clearTimeout(p.timer);
    try {
      ws.send(JSON.stringify(p.frame));
    } catch {
      p.ws = null;
      p.timer = setTimeout(() => settle(p.frame.id, false), timeoutMs);
    }
  };

  return {
    routes: {
      'POST /api/ui/socket-ticket': ({ query }) => ({ ticket: tickets.issue({ popout: query.get('popout') === '1' }) }),
    },
    sockets: {
      [UI_SOCKET_PATH]: {
        tickets,
        open(ws, data: { popout: boolean }) {
          conns.push({ ws, popout: data?.popout === true });
          for (const p of pending.values()) {
            if (p.ws === null) {
              const target = pick();
              if (target) dispatch(p, target);
            }
          }
        },
        message(ws, msg) {
          let frame: Partial<UiAnswer>;
          try {
            frame = JSON.parse(String(msg));
          } catch {
            return;
          }
          if (frame.type !== 'answer' || typeof frame.id !== 'string') return;
          if (pending.get(frame.id)?.ws !== ws) return;
          settle(frame.id, frame.ok === true);
        },
        close(ws) {
          const i = conns.findIndex((c) => c.ws === ws);
          if (i >= 0) conns.splice(i, 1);
          for (const [id, p] of [...pending]) {
            if (p.ws !== ws) continue;
            const target = pick();
            if (target) dispatch(p, target);
            else settle(id, false);
          }
        },
      },
    },
    confirm(o) {
      return new Promise<boolean>((resolve) => {
        const id = randomUUID();
        const p: Pending = { frame: { type: 'confirm', id, ...o }, resolve, ws: null };
        pending.set(id, p);
        const target = pick();
        if (target) {
          dispatch(p, target);
          return;
        }
        p.timer = setTimeout(() => settle(id, false), timeoutMs);
        try {
          void Promise.resolve(reveal()).catch(() => {});
        } catch {
          // a failed reveal leaves the timeout to answer
        }
      });
    },
    setReveal(fn) {
      reveal = fn;
    },
    connected: () => conns.length,
  };
}
