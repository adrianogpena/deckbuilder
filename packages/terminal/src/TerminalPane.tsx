import { copyText, effectiveKeys, errorMessage, errorOf, paletteCommand, t, useKeybindings, type CommandDef } from '@deckbuilder/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { attachSession, closeSession, isSessionGone, openSession, socketUrl, type TerminalCwd, type TerminalLaunch } from './client.ts';
import { terminalKeyAction } from './keys.ts';
import { decodeServerMessage, encodeControl } from './protocol.ts';
import { createXtermView, type XtermView } from './xterm-view.ts';
import './terminal.css';

/** Server close codes (see `terminalRoutes`). */
const BACKPRESSURE_CLOSE = 4001;
const NO_SESSION_CLOSE = 1008;
const NORMAL_CLOSE = 1000;
const MAX_BACKOFF = 30_000;

export interface TerminalPaneProps {
  /** The session to attach to; none opens a new one and reports it through `onSession`. */
  session?: string;
  /** Where a new session starts; the user's home when absent. */
  cwd?: TerminalCwd;
  /** A launcher the app registered on the server, instead of the configured shell. */
  launch?: TerminalLaunch;
  /** Read-only, at the session's own size, scaled to the box. */
  preview?: boolean;
  /** App commands whose keys still work while the terminal has focus; default: the command palette. */
  appKeys?: CommandDef[];
  fontSize?: number;
  onSession?: (id: string) => void;
  onExit?: (code: number | null) => void;
  onTitle?: (title: string) => void;
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'reconnecting' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'ended' }
  | { kind: 'detached' }
  | { kind: 'error'; message: string };

interface Controller {
  /** The session the pane is connected (or connecting) to. */
  session(): string | undefined;
  attach(id: string): void;
  restart(): void;
  reattach(): void;
}

/**
 * A terminal session in a box. Unmounting only closes the socket: the shell keeps running until
 * `closeSession`, its own exit, or app quit. While focus is inside, keys go to the program except
 * the `appKeys` commands (the container is `data-keys="own"`).
 */
export function TerminalPane(props: TerminalPaneProps) {
  const { preview = false } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const controller = useRef<Controller | null>(null);

  const kb = useKeybindings();
  const appKeys = useMemo(() => props.appKeys ?? [paletteCommand()], [props.appKeys]);
  const appChords = useRef(new Set<string>());
  appChords.current = useMemo(() => {
    const keys = kb ? effectiveKeys(kb.defs, kb.keymap) : new Map<string, string[]>();
    return new Set(appKeys.flatMap((d) => keys.get(d.id) ?? d.keys));
  }, [kb, appKeys]);

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let ws: WebSocket | null = null;
    let sessionId = latest.current.session;
    let decoder = new TextDecoder();
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    const encoder = new TextEncoder();

    const view: XtermView = createXtermView(host, {
      readOnly: preview,
      fontSize: latest.current.fontSize,
      onKey: (e) => {
        if (preview || e.type !== 'keydown') return true;
        switch (terminalKeyAction(e, view.hasSelection(), appChords.current)) {
          case 'app':
          case 'paste': // the browser's paste event reaches xterm
            return false;
          case 'copy':
            e.preventDefault();
            void copyText(view.getSelection());
            return false;
          default:
            return true;
        }
      },
    });

    const send = (data: string | Uint8Array) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    };
    view.onInput((data) => send(encoder.encode(data)));
    view.onResize((cols, rows) => {
      if (!preview) send(encodeControl({ type: 'resize', cols, rows }));
    });

    // A preview renders at the session's size, scaled down to the box.
    const scale = () => {
      const box = boxRef.current;
      if (!preview || !box) return;
      const el = view.element();
      const s = Math.min(1, box.clientWidth / (el.offsetWidth || 1), box.clientHeight / (el.offsetHeight || 1));
      host.style.transform = `scale(${s})`;
    };
    const boxObserver = new ResizeObserver(scale);
    if (preview && boxRef.current) boxObserver.observe(boxRef.current);

    const stop = (next: Status) => {
      ended = true;
      setStatus(next);
    };

    const retryLater = () => {
      setStatus({ kind: 'reconnecting' });
      const delay = Math.min(MAX_BACKOFF, 500 * 2 ** retries++);
      timer = setTimeout(() => void connect(false), delay);
    };

    function openSocket(ticket: string) {
      const socket = new WebSocket(socketUrl(ticket));
      const previous = ws;
      ws = socket;
      previous?.close();
      socket.binaryType = 'arraybuffer';
      socket.onmessage = (ev) => {
        if (ws !== socket) return;
        const m = decodeServerMessage(ev.data as string | ArrayBuffer);
        if (!m) return;
        if (m.kind === 'output') {
          view.write(decoder.decode(m.data, { stream: true }));
          return;
        }
        const msg = m.msg;
        if (msg.type === 'hello') {
          // The replay that follows redraws the screen from scratch.
          retries = 0;
          view.reset();
          decoder = new TextDecoder();
          if (preview) {
            view.resize(msg.cols, msg.rows);
            requestAnimationFrame(scale);
          } else {
            view.fit();
            const { cols, rows } = view.size();
            if (cols !== msg.cols || rows !== msg.rows) send(encodeControl({ type: 'resize', cols, rows }));
            view.focus();
          }
          setStatus({ kind: 'live' });
        } else if (msg.type === 'exit') {
          stop({ kind: 'exited', code: msg.code });
          latest.current.onExit?.(msg.code);
        } else {
          latest.current.onTitle?.(msg.title);
        }
      };
      socket.onclose = (ev) => {
        if (ws !== socket) return;
        ws = null;
        if (disposed || ended) return;
        if (ev.code === BACKPRESSURE_CLOSE) void connect(false);
        else if (ev.code === NO_SESSION_CLOSE) stop({ kind: 'ended' });
        // A plain close without an exit: another interactive view took the session.
        else if (ev.code === NORMAL_CLOSE) stop({ kind: 'detached' });
        else retryLater();
      };
    }

    async function connect(fresh: boolean) {
      clearTimeout(timer);
      ended = false;
      try {
        let ticketed;
        if (fresh || !sessionId) {
          view.fit();
          const { cols, rows } = view.size();
          const { cwd, launch } = latest.current;
          ticketed = await openSession({ cols, rows, cwd, launch });
          if (disposed) {
            // Unmounted while opening (React strict mode remounts): nobody holds this session.
            void closeSession(ticketed.session).catch(() => {});
            return;
          }
          sessionId = ticketed.session;
          latest.current.onSession?.(ticketed.session);
        } else {
          ticketed = await attachSession(sessionId, preview ? 'preview' : 'interactive');
          if (disposed) return;
        }
        openSocket(ticketed.ticket);
      } catch (err) {
        if (disposed) return;
        if (isSessionGone(err)) stop({ kind: 'ended' });
        else if (errorOf(err).kind === 'offline') retryLater();
        else stop({ kind: 'error', message: errorMessage(errorOf(err)) });
      }
    }

    controller.current = {
      session: () => sessionId,
      attach: (id) => {
        sessionId = id;
        ws?.close();
        ws = null;
        setStatus({ kind: 'connecting' });
        void connect(false);
      },
      restart: () => {
        setStatus({ kind: 'connecting' });
        void connect(true);
      },
      reattach: () => {
        setStatus({ kind: 'connecting' });
        void connect(false);
      },
    };
    void connect(false);

    return () => {
      disposed = true;
      clearTimeout(timer);
      boxObserver.disconnect();
      ws?.close();
      ws = null;
      controller.current = null;
      view.dispose();
    };
  }, [preview]);

  // A new `session` prop (not the one this pane just opened and reported) switches sessions.
  useEffect(() => {
    const c = controller.current;
    if (c && props.session && props.session !== c.session()) c.attach(props.session);
  }, [props.session]);

  const overlay = overlayOf(status, preview, controller);
  return (
    <div
      ref={boxRef}
      className={`terminal-pane${preview ? ' preview' : ''}`}
      {...(preview ? {} : { 'data-keys': 'own', 'data-keys-allow': appKeys.map((d) => d.id).join(' ') })}
    >
      <div ref={hostRef} className="terminal-host" />
      {overlay && <div className="terminal-overlay">{overlay}</div>}
    </div>
  );
}

function overlayOf(status: Status, preview: boolean, controller: { current: Controller | null }) {
  const action = (label: string, run: (c: Controller) => void) =>
    preview ? null : (
      <button type="button" className="btn btn-sm" onClick={() => controller.current && run(controller.current)}>
        {label}
      </button>
    );
  switch (status.kind) {
    case 'live':
      return null;
    case 'connecting':
      return <span>{t('terminal.connecting')}</span>;
    case 'reconnecting':
      return <span>{t('terminal.reconnecting')}</span>;
    case 'exited':
      return (
        <>
          <span>{status.code === null ? t('terminal.exitedNoCode') : t('terminal.exited', { code: status.code })}</span>
          {action(t('terminal.restart'), (c) => c.restart())}
        </>
      );
    case 'ended':
      return (
        <>
          <span>{t('terminal.ended')}</span>
          {action(t('terminal.restart'), (c) => c.restart())}
        </>
      );
    case 'detached':
      return (
        <>
          <span>{t('terminal.detached')}</span>
          {action(t('terminal.reattach'), (c) => c.reattach())}
        </>
      );
    case 'error':
      return (
        <>
          <span className="terminal-error">{t('terminal.error', { message: status.message })}</span>
          {action(t('common.retry'), (c) => c.reattach())}
        </>
      );
  }
}
