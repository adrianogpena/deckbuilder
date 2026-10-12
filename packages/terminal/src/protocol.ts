export const TERMINAL_SOCKET_PATH = '/api/terminal/socket';
export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;
export const MAX_CONTROL_BYTES = 64 * 1024;
export const MAX_TITLE = 256;

export type ClientControl = { type: 'resize'; cols: number; rows: number } | { type: 'close' };

export type ServerControl =
  | { type: 'hello'; session: string; cols: number; rows: number }
  | { type: 'exit'; code: number | null }
  | { type: 'title'; title: string };

export type ClientMessage = { kind: 'input'; data: Uint8Array } | { kind: 'control'; msg: ClientControl };
export type ServerMessage = { kind: 'output'; data: Uint8Array } | { kind: 'control'; msg: ServerControl };

type Frame = string | ArrayBuffer | Uint8Array;

export const encodeControl = (msg: ClientControl | ServerControl): string => JSON.stringify(msg);

const isSize = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;

const parseControl = (text: string): Record<string, unknown> | null => {
  if (text.length > MAX_CONTROL_BYTES) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const bytes = (frame: ArrayBuffer | Uint8Array): Uint8Array => (frame instanceof Uint8Array ? frame : new Uint8Array(frame));

export function decodeClientMessage(frame: Frame): ClientMessage | null {
  if (typeof frame !== 'string') return { kind: 'input', data: bytes(frame) };
  const m = parseControl(frame);
  if (!m) return null;
  if (m.type === 'close') return { kind: 'control', msg: { type: 'close' } };
  if (m.type === 'resize' && isSize(m.cols, MAX_COLS) && isSize(m.rows, MAX_ROWS)) {
    return { kind: 'control', msg: { type: 'resize', cols: m.cols, rows: m.rows } };
  }
  return null;
}

export function decodeServerMessage(frame: Frame): ServerMessage | null {
  if (typeof frame !== 'string') return { kind: 'output', data: bytes(frame) };
  const m = parseControl(frame);
  if (!m) return null;
  if (m.type === 'hello' && typeof m.session === 'string' && isSize(m.cols, MAX_COLS) && isSize(m.rows, MAX_ROWS)) {
    return { kind: 'control', msg: { type: 'hello', session: m.session, cols: m.cols, rows: m.rows } };
  }
  if (m.type === 'exit' && (m.code === null || (typeof m.code === 'number' && Number.isFinite(m.code)))) {
    return { kind: 'control', msg: { type: 'exit', code: m.code } };
  }
  if (m.type === 'title' && typeof m.title === 'string') {
    return { kind: 'control', msg: { type: 'title', title: m.title.slice(0, MAX_TITLE) } };
  }
  return null;
}
