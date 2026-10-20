import { useEffect, useState, type ReactNode } from 'react';
import { request } from '../api';
import { registerDialogHost, dialogs } from '../dialogs';
import { t } from '../i18n';
import { popoutView } from '../popout';
import { useDialogs } from './ui';

interface ConfirmFrame {
  type: 'confirm';
  id: string;
  title: string;
  message: string;
  ok?: string;
  okKey?: string;
  danger?: boolean;
}

/**
 * Mounts once per app: shows the dialogs of the global `dialogs` API and answers the server's
 * confirm requests over the broker socket (`/api/ui/socket`; an app without the broker is left alone).
 */
export function DialogHost() {
  const local = useDialogs();
  const [opened, setOpened] = useState<Array<{ id: number; node: ReactNode }>>([]);
  const { confirm, prompt, choose } = local;

  useEffect(() => {
    let seq = 0;
    return registerDialogHost({
      confirm,
      prompt,
      choose,
      open(node) {
        const id = ++seq;
        setOpened((o) => [...o, { id, node }]);
        return () => setOpened((o) => o.filter((x) => x.id !== id));
      },
    });
  }, [confirm, prompt, choose]);

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    const connect = async () => {
      let ticket: string;
      try {
        ({ ticket } = await request<{ ticket: string }>('POST', '/api/ui/socket-ticket'));
      } catch (err) {
        if (stopped) return;
        const info = (err as { info?: { kind?: string; code?: string; params?: { status?: number } } }).info;
        if (info?.kind === 'notfound' || info?.params?.status === 404) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
        return;
      }
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const popout = popoutView() !== undefined ? '&popout=1' : '';
      const socket = new WebSocket(`${proto}//${location.host}/api/ui/socket?t=${encodeURIComponent(ticket)}${popout}`);
      ws = socket;
      socket.onopen = () => {
        delay = 1000;
      };
      socket.onmessage = (e) => {
        let f: ConfirmFrame;
        try {
          f = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (f.type !== 'confirm') return;
        const okLabel = f.okKey ? t(f.okKey as Parameters<typeof t>[0]) : f.ok;
        void dialogs
          .confirm({ title: f.title, body: <div style={{ whiteSpace: 'pre-wrap' }}>{f.message}</div>, okLabel, danger: f.danger })
          .then((ok) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'answer', id: f.id, ok }));
          });
      };
      socket.onclose = () => {
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return (
    <>
      {local.element}
      {opened.map((o) => <span key={o.id} style={{ display: 'contents' }}>{o.node}</span>)}
    </>
  );
}
