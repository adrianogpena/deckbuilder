import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invalid, notFound } from '@kedalion/server-core';

export type ConnectionType = 'jira' | 'github';

export interface Connection {
  id: string;
  type: ConnectionType;
  name: string;
  baseUrl: string;
  user?: string;
  token?: string;
}

/** What list/get routes return: the token never leaves the server. */
export interface PublicConnection {
  id: string;
  type: ConnectionType;
  name: string;
  baseUrl: string;
  user?: string;
  hasToken: boolean;
}

export interface ConnectionInput {
  /** Set to update that connection. */
  id?: string;
  type?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  user?: unknown;
  /** Empty or missing keeps the stored token. */
  token?: unknown;
}

export const GITHUB_API = 'https://api.github.com';
export const MAX_CONNECTIONS = 50;
const MAX_TEXT = 200;
const MAX_TOKEN = 4096;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isConnectionType = (v: unknown): v is ConnectionType => v === 'jira' || v === 'github';

export const publicOf = ({ token, ...rest }: Connection): PublicConnection => ({ ...rest, hasToken: !!token });

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanUrl(raw: string, type: ConnectionType): string {
  const value = raw || (type === 'github' ? GITHUB_API : '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid('connection-url', 'Enter a valid http(s) address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('connection-url', 'Enter a valid http(s) address.');
  return url.href.replace(/\/+$/, '');
}

/** Connections of `<dataDir>/grid/connections.json`, outside the settings store so backups never see tokens. */
export function createConnectionStore(dataDir: string) {
  const dir = join(dataDir, 'grid');
  const file = join(dir, 'connections.json');
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<Connection[]> => {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      return Array.isArray(raw) ? raw.filter((c): c is Connection => !!c && ID_RE.test(c.id) && isConnectionType(c.type)) : [];
    } catch {
      return [];
    }
  };
  const write = async (all: Connection[]) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2));
    await rename(tmp, file);
  };
  const locked = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  return {
    async list(): Promise<PublicConnection[]> {
      return (await read()).map(publicOf);
    },
    /** With the token, for server use only. */
    async get(id: string): Promise<Connection | undefined> {
      return (await read()).find((c) => c.id === id);
    },
    save(input: ConnectionInput): Promise<PublicConnection> {
      return locked(async () => {
        const all = await read();
        const prev = input.id === undefined ? undefined : all.find((c) => c.id === input.id);
        if (input.id !== undefined && !prev) throw notFound('connection-missing', 'This connection no longer exists.');
        const type = prev?.type ?? input.type;
        if (!isConnectionType(type)) throw invalid('connection-type', 'Choose Jira or GitHub.');
        const name = str(input.name, MAX_TEXT);
        if (!name) throw invalid('connection-name', 'Enter a name.');
        const baseUrl = cleanUrl(str(input.baseUrl, 2000), type);
        const user = str(input.user, MAX_TEXT);
        const token = str(input.token, MAX_TOKEN);
        if (!prev && all.length >= MAX_CONNECTIONS) throw invalid('connection-limit', 'Too many connections.');
        const next: Connection = {
          id: prev?.id ?? crypto.randomUUID().replace(/-/g, '').slice(0, 12),
          type,
          name,
          baseUrl,
          ...(user ? { user } : {}),
          ...((token || prev?.token) ? { token: token || prev!.token } : {}),
        };
        await write(prev ? all.map((c) => (c.id === prev.id ? next : c)) : [...all, next]);
        return publicOf(next);
      });
    },
    remove(id: string): Promise<void> {
      return locked(async () => {
        const all = await read();
        if (all.some((c) => c.id === id)) await write(all.filter((c) => c.id !== id));
      });
    },
  };
}

export type ConnectionStore = ReturnType<typeof createConnectionStore>;
