import { randomBytes, timingSafeEqual } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Routes } from '@deckbuilder/server-core';

// Single instance: the running app publishes its port and a secret in instance.json (in the app
// data folder). A second launch asks it to open what was requested and exits. The secret only
// unlocks this one route, not the API.

export const INSTANCE_HEADER = 'x-deckbuilder-instance';
export const INSTANCE_ROUTE = 'POST /api/instance/open';

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
 * Asks the instance published in `file` to open `mode`. Resolves with its UI address, or null
 * when none answers (no file, or a stale one left by a killed process).
 */
export async function handOff(file: string, mode: OpenMode, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const info = readInfo(file);
  if (!info) return null;
  try {
    const res = await fetchFn(`http://127.0.0.1:${info.port}/api/instance/open`, {
      method: 'POST',
      headers: { [INSTANCE_HEADER]: info.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: unknown };
    return typeof body.url === 'string' ? body.url : null;
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

/** `open` opens what a later launch asked for and returns the UI address. */
export function createInstance(file: string, open: (mode: OpenMode) => string): Instance {
  const secret = Buffer.from(randomBytes(24).toString('hex'));
  return {
    routes: {
      [INSTANCE_ROUTE]: async ({ req, json }) => {
        const given = Buffer.from(req.headers.get(INSTANCE_HEADER) ?? '');
        if (given.length !== secret.length || !timingSafeEqual(given, secret)) return new Response('Forbidden', { status: 403 });
        const { mode } = await json<{ mode?: unknown }>();
        return { url: open(mode === 'app' || mode === 'browser' || mode === 'none' ? mode : 'window') };
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

/**
 * Takes the start-up lock that keeps two launches from both becoming the instance. 'held' means
 * another live launch has it; a lock left by a dead process is taken over. Released on exit.
 */
export function acquireLock(file: string): 'acquired' | 'held' {
  mkdirSync(dirname(file), { recursive: true });
  // Link a complete temp file into place: the lock never exists without its pid.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, String(process.pid));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(tmp, file);
        process.on('exit', () => {
          if (lockPid(file) === process.pid) rmSync(file, { force: true });
        });
        return 'acquired';
      } catch (err) {
        if ((err as { code?: string }).code !== 'EEXIST') throw err;
      }
      const pid = lockPid(file);
      if (pid !== null && pid !== process.pid && alive(pid)) return 'held';
      rmSync(file, { force: true });
    }
    return 'held';
  } finally {
    rmSync(tmp, { force: true });
  }
}
