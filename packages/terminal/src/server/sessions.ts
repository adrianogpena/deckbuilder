import { invalid, notFound } from '@deckbuilderkit/server-core';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import type { SessionInfo } from '../protocol.ts';
import { spawnPty, type Pty } from './pty.ts';

export type { SessionInfo };

export type ViewKind = 'interactive' | 'preview';

export interface Sink {
  send(frame: string | Uint8Array): void;
  close(): void;
}

export interface CreateOptions {
  cmd: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
  label: string;
  launcher?: string;
  meta?: Record<string, unknown>;
  profile?: string;
  shell?: string;
}

const MAX_CWD = 4096;

/** The local path of an OSC 7 `file://host/path` payload (Windows drive paths get backslashes), or null. */
export function cwdFromOsc7(data: string): string | null {
  if (!data.startsWith('file://') || data.length > MAX_CWD) return null;
  const rest = data.slice('file://'.length);
  const slash = rest.search(/[/\\]/);
  if (slash < 0) return null;
  let path = rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {}
  if (/^[/\\][A-Za-z]:/.test(path)) path = path.slice(1).replace(/\//g, '\\');
  if (/^[A-Za-z]:$/.test(path)) path += '\\';
  return path && !path.includes('\0') ? path : null;
}

export interface Session {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt: number;
}

export interface TerminalSessions {
  create(opts: CreateOptions): Session;
  get(id: string): Session | undefined;
  list(): SessionInfo[];
  attach(id: string, sink: Sink, view: ViewKind): void;
  detach(id: string, sink: Sink): void;
  write(id: string, sink: Sink, data: string | Uint8Array): void;
  resize(id: string, sink: Sink, cols: number, rows: number): void;
  /** Drops the replay buffer's scrollback (the interactive view cleared its screen). */
  clear(id: string, sink: Sink): void;
  close(id: string, sink?: Sink): void;
  closeAll(): void;
  setLabel(id: string, label: string): void;
  setMeta(id: string, meta: Record<string, unknown> | undefined): void;
  /** The last `n` lines of the headless screen (read-only). */
  screenLines(id: string, n: number): string[];
}

export interface TerminalSessionsOptions {
  spawn?: typeof spawnPty;
  max?: number;
  now?: () => number;
}

const SCROLLBACK = 5000;
const MAX_LABEL = 80;
const MAX_META_BYTES = 4096;

interface Viewer {
  sink: Sink;
  view: ViewKind;
  ready: boolean;
  exitSent: boolean;
}

interface Entry extends Session {
  cwd: string;
  profile?: string;
  shell?: string;
  running?: boolean;
  pty: Pty;
  term: Terminal;
  serializer: SerializeAddon;
  label: string;
  launcher?: string;
  meta?: Record<string, unknown>;
  cols: number;
  rows: number;
  exited: number | null | undefined;
  title: string;
  bells: number;
  lastOutputAt: number;
  viewers: Viewer[];
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

const control = (msg: Record<string, unknown>) => JSON.stringify(msg);

function checkMeta(meta: Record<string, unknown> | undefined): void {
  if (meta !== undefined && JSON.stringify(meta).length > MAX_META_BYTES) {
    throw invalid('terminalMeta', 'Session metadata is too large');
  }
}

export function terminalSessions({ spawn = spawnPty, max = 20, now = Date.now }: TerminalSessionsOptions = {}): TerminalSessions {
  const entries = new Map<string, Entry>();

  const must = (id: string): Entry => {
    const e = entries.get(id);
    if (!e) throw notFound('terminalSession', 'No such terminal session');
    return e;
  };

  const interactive = (e: Entry) => e.viewers.find((v) => v.view === 'interactive');

  function broadcast(e: Entry, frame: string | Uint8Array): void {
    for (const v of e.viewers) if (v.ready) v.sink.send(frame);
  }

  function create(opts: CreateOptions): Session {
    if (entries.size >= max) reapExited();
    if (entries.size >= max) throw invalid('terminalLimit', 'Too many terminal sessions', { max });
    checkMeta(opts.meta);
    const pty = spawn(opts.cmd, opts.cwd, opts.cols, opts.rows, opts.env);
    const term = new Terminal({ cols: opts.cols, rows: opts.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);
    const createdAt = now();
    const e: Entry = {
      id: randomId(),
      cwd: opts.cwd,
      createdAt,
      pty,
      term,
      serializer,
      label: opts.label.slice(0, MAX_LABEL),
      launcher: opts.launcher,
      meta: opts.meta,
      profile: opts.profile,
      shell: opts.shell,
      cols: opts.cols,
      rows: opts.rows,
      exited: undefined,
      title: '',
      bells: 0,
      lastOutputAt: createdAt,
      viewers: [],
    };
    entries.set(e.id, e);

    // The interactive client answers terminal queries itself; headless answers only when none is attached.
    term.onData((reply) => {
      if (!interactive(e) && e.exited === undefined) pty.write(reply);
    });
    term.onTitleChange((title) => {
      e.title = title;
      broadcast(e, control({ type: 'title', title }));
    });
    term.onBell(() => {
      e.bells++;
    });
    // Shell integration: OSC 7 reports the cwd, OSC 133 C/D bracket a running command.
    term.parser.registerOscHandler(7, (data) => {
      const cwd = cwdFromOsc7(data);
      if (cwd) e.cwd = cwd;
      return true;
    });
    term.parser.registerOscHandler(133, (data) => {
      const mark = data.split(';', 1)[0];
      if (mark === 'C') e.running = true;
      else if (mark === 'D' || mark === 'A') e.running = false;
      return true;
    });

    pty.onData((data) => {
      const chunk = data.slice();
      e.lastOutputAt = now();
      // Viewers get the bytes after the replay state has parsed them, so an attach never sees a gap.
      try {
        term.write(chunk, () => broadcast(e, chunk));
      } catch {
        close(e.id);
      }
    });
    pty.onExit((code) => {
      if (e.exited !== undefined) return;
      e.exited = code;
      term.write('', () => {
        const frame = control({ type: 'exit', code });
        for (const v of e.viewers) {
          if (v.ready && !v.exitSent) v.sink.send(frame);
          v.exitSent = true;
        }
      });
    });
    return e;
  }

  function attach(id: string, sink: Sink, view: ViewKind): void {
    const e = must(id);
    if (view === 'interactive') {
      const prev = interactive(e);
      if (prev) {
        e.viewers = e.viewers.filter((v) => v !== prev);
        prev.sink.close();
      }
    }
    sink.send(control({ type: 'hello', session: e.id, cols: e.cols, rows: e.rows }));
    // Live output starts once every earlier chunk has been parsed: the replay then ends exactly where it begins.
    const viewer: Viewer = { sink, view, ready: false, exitSent: false };
    e.viewers.push(viewer);
    e.term.write('', () => {
      if (!e.viewers.includes(viewer)) return;
      sink.send(new TextEncoder().encode(e.serializer.serialize()));
      if (e.title) sink.send(control({ type: 'title', title: e.title }));
      if (e.exited !== undefined) {
        sink.send(control({ type: 'exit', code: e.exited }));
        viewer.exitSent = true;
      }
      viewer.ready = true;
    });
  }

  function detach(id: string, sink: Sink): void {
    const e = entries.get(id);
    if (!e) return;
    e.viewers = e.viewers.filter((v) => v.sink !== sink);
    if (e.exited !== undefined && e.viewers.length === 0) close(id);
  }

  function reapExited(): void {
    for (const e of [...entries.values()]) if (e.exited !== undefined && e.viewers.length === 0) close(e.id);
  }

  const isInteractive = (e: Entry, sink: Sink) => interactive(e)?.sink === sink;

  function write(id: string, sink: Sink, data: string | Uint8Array): void {
    const e = entries.get(id);
    if (e && e.exited === undefined && isInteractive(e, sink)) e.pty.write(data);
  }

  function resize(id: string, sink: Sink, cols: number, rows: number): void {
    const e = entries.get(id);
    if (!e || e.exited !== undefined || !isInteractive(e, sink)) return;
    e.cols = cols;
    e.rows = rows;
    e.pty.resize(cols, rows);
    e.term.resize(cols, rows);
  }

  function clear(id: string, sink: Sink): void {
    const e = entries.get(id);
    if (!e || !isInteractive(e, sink)) return;
    // After the output already queued, like the view's own clear.
    e.term.write('', () => e.term.clear());
  }

  function close(id: string, sink?: Sink): void {
    const e = entries.get(id);
    if (!e) return;
    if (sink && !isInteractive(e, sink)) return;
    entries.delete(id);
    if (e.exited === undefined) e.pty.kill();
    for (const v of e.viewers) v.sink.close();
    e.viewers = [];
    e.term.dispose();
  }

  return {
    create,
    get: (id) => entries.get(id),
    list: () =>
      [...entries.values()].map((e) => ({
        id: e.id,
        label: e.label,
        launcher: e.launcher,
        meta: e.meta,
        cwd: e.cwd,
        profile: e.profile,
        shell: e.shell,
        running: e.running,
        cols: e.cols,
        rows: e.rows,
        createdAt: e.createdAt,
        exited: e.exited,
        title: e.title,
        bells: e.bells,
        lastOutputAt: e.lastOutputAt,
        viewers: { interactive: !!interactive(e), previews: e.viewers.filter((v) => v.view === 'preview').length },
      })),
    attach,
    detach,
    write,
    resize,
    clear,
    close,
    closeAll: () => {
      for (const id of [...entries.keys()]) close(id);
    },
    setLabel(id, label) {
      must(id).label = label.slice(0, MAX_LABEL);
    },
    screenLines(id, n) {
      const buf = must(id).term.buffer.active;
      const out: string[] = [];
      for (let y = Math.max(0, buf.length - n); y < buf.length; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '');
      return out;
    },
    setMeta(id, meta) {
      checkMeta(meta);
      must(id).meta = meta;
    },
  };
}
