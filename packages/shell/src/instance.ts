import { randomBytes, timingSafeEqual } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Routes } from '@deckbuilderkit/server-core';
import { isSafePath } from './link.ts';

// Single instance: the running app publishes its port and a secret in instance.json (in the app
// data folder). A second launch asks it to open what was requested and exits. The secret only
// unlocks this one route, not the API: its response carries no session token, at most a launch URL
// with a one-time code.

export const INSTANCE_HEADER = 'x-deckbuilder-instance';
export const INSTANCE_PATH = '/api/instance/open';
export const INSTANCE_ROUTE = `POST ${INSTANCE_PATH}`;

/** What a launch asks for: a native window, an Edge/Chrome app window, a browser tab, or nothing (`--no-open`). */
export type OpenMode = 'window' | 'app' | 'browser' | 'none';

interface InstanceInfo {
  pid: number;
  port: number;
  secret: string;
}

function readInfo(file: string): InstanceInfo | null {
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<InstanceInfo>;
    return typeof info.port === 'number' && typeof info.secret === 'string' && typeof info.pid === 'number' ? (info as InstanceInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Asks the instance published in `file` to open `mode`, on `path` when given. Resolves true once it
 * opened it, a fresh launch URL for mode 'none', or null when none answers (no file, or a stale one
 * left by a killed process).
 */
export async function handOff(file: string, mode: OpenMode, path?: string, fetchFn: typeof fetch = fetch): Promise<true | string | null> {
  const info = readInfo(file);
  if (!info) return null;
  try {
    const res = await fetchFn(`http://127.0.0.1:${info.port}${INSTANCE_PATH}`, {
      method: 'POST',
      headers: { [INSTANCE_HEADER]: info.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, path }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: unknown; ok?: unknown };
    if (typeof body.url === 'string') return body.url;
    return body.ok === true ? true : null;
  } catch {
    return null;
  }
}

export interface Instance {
  /** Unauthenticated route for the server; it checks the secret itself. */
  routes: Routes;
  /** Writes instance.json once the server listens; it is removed again on exit. */
  publish(port: number): void;
}

/**
 * `open` opens what a later launch asked for and returns the launch URL it used, if any. Only mode
 * 'none' sends it back: that launch wants an address to print.
 */
export function createInstance(file: string, open: (mode: OpenMode, path?: string) => string | null): Instance {
  const secret = Buffer.from(randomBytes(24).toString('hex'));
  return {
    routes: {
      [INSTANCE_ROUTE]: async ({ req, json }) => {
        const given = Buffer.from(req.headers.get(INSTANCE_HEADER) ?? '');
        if (given.length !== secret.length || !timingSafeEqual(given, secret)) return new Response('Forbidden', { status: 403 });
        const { mode, path } = await json<{ mode?: unknown; path?: unknown }>();
        const safe = typeof path === 'string' && isSafePath(path) ? path : undefined;
        const m = mode === 'app' || mode === 'browser' || mode === 'none' ? mode : 'window';
        const url = open(m, safe);
        return m === 'none' && url !== null ? { url } : { ok: true };
      },
    },
    publish(port) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ pid: process.pid, port, secret: secret.toString() }), { mode: 0o600 });
      process.on('exit', () => {
        // A later instance may have taken the file over (e.g. after an update); leave its file.
        if (readInfo(file)?.pid === process.pid) rmSync(file, { force: true });
      });
    },
  };
}

function lockPid(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as { code?: string }).code === 'EPERM';
  }
}

/** A lock older than this whose pid isn't the published instance is stale, whatever the pid. */
const LOCK_MAX_AGE_MS = 60_000;

/**
 * A lock is stale when its process is gone, or when it is old and no published instance owns it:
 * pids get reused, so a dead launch's lock can name a live, unrelated process.
 */
function staleLock(file: string, pid: number | null, now: number, instanceFile: string): boolean {
  if (pid === null || pid === process.pid || !alive(pid)) return true;
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return true;
  }
  return now - mtime > LOCK_MAX_AGE_MS && readInfo(instanceFile)?.pid !== pid;
}

/**
 * Takes the start-up lock that keeps two launches from both becoming the instance. 'held' means
 * another live launch has it; a stale lock (see `staleLock`) is taken over. Released on exit.
 * `instanceFile` defaults to instance.json next to the lock.
 */
export function acquireLock(file: string, opts: { now?: () => number; instanceFile?: string } = {}): 'acquired' | 'held' {
  const now = opts.now ?? Date.now;
  const instanceFile = opts.instanceFile ?? join(dirname(file), 'instance.json');
  mkdirSync(dirname(file), { recursive: true });
  // Link a complete temp file into place: the lock never exists without its pid.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, String(process.pid));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(tmp, file);
      } catch (err) {
        if ((err as { code?: string }).code !== 'EEXIST') throw err;
        if (!staleLock(file, lockPid(file), now(), instanceFile)) return 'held';
        rmSync(file, { force: true });
        continue;
      }
      // Two launches that both found the same stale lock: the later one removed ours. Wait for
      // such a launch to finish its link, then trust only what is on disk.
      Bun.sleepSync(100);
      if (lockPid(file) !== process.pid) return 'held';
      process.on('exit', () => {
        if (lockPid(file) === process.pid) rmSync(file, { force: true });
      });
      return 'acquired';
    }
    return 'held';
  } finally {
    rmSync(tmp, { force: true });
  }
}
