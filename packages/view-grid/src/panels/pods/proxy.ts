import { DNS_1123 } from './model';

/** The proxy cannot start, died or cannot be reached: the caller falls back to plain kubectl. */
export class ProxyUnavailable extends Error {}

/** The cluster answered with an HTTP error; a real error, never a fallback. */
export class ProxyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const START_TIMEOUT_MS = 10_000;
const IDLE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** The port of kubectl's `Starting to serve on 127.0.0.1:PORT` line, or undefined. */
export function parseProxyPort(out: string): number | undefined {
  const m = /Starting to serve on (?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\s/.exec(out);
  return m ? Number(m[1]) : undefined;
}

const name = (value: string, what: string): string => {
  if (typeof value !== 'string' || value.length > 253 || !DNS_1123.test(value)) throw new Error(`Invalid ${what} name.`);
  return value;
};

/** API paths of the proxied reads; every name is validated first, so no unchecked input reaches a URL. */
export const kubePaths = {
  namespaces: () => '/api/v1/namespaces',
  pods: (ns: string) => `/api/v1/namespaces/${name(ns, 'namespace')}/pods`,
  pod: (ns: string, pod: string) => `/api/v1/namespaces/${name(ns, 'namespace')}/pods/${name(pod, 'pod')}`,
  ingresses: (ns: string) => `/apis/networking.k8s.io/v1/namespaces/${name(ns, 'namespace')}/ingresses`,
  podMetrics: (ns: string, pod: string) => `/apis/metrics.k8s.io/v1beta1/namespaces/${name(ns, 'namespace')}/pods/${name(pod, 'pod')}`,
};

const REASONS: Record<number, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  408: 'Timeout',
  429: 'TooManyRequests',
  500: 'InternalError',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** An error message in kubectl's wording, so `classifyStderr` maps it like a kubectl failure. */
export function httpErrorMessage(status: number, body: string): string {
  let reason: unknown;
  let message: unknown;
  try {
    ({ reason, message } = JSON.parse(body) as { reason?: unknown; message?: unknown });
  } catch {
    // A non-JSON body is used as is.
  }
  const label = typeof reason === 'string' && reason ? reason : (REASONS[status] ?? String(status));
  const detail = typeof message === 'string' && message ? message : body.trim().slice(0, 300);
  return `Error from server (${label}): ${detail || label}`;
}

/** The part of a spawned `kubectl proxy` the manager uses (a `Bun.spawn` subprocess fits). */
export interface ProxyChild {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface KubeProxyOptions {
  spawn?: (context: string) => ProxyChild;
  fetch?: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  startTimeoutMs?: number;
  idleMs?: number;
}

interface Entry {
  child: ProxyChild;
  base: Promise<string>;
  timer?: ReturnType<typeof setTimeout>;
  dropped?: boolean;
}

function spawnProxy(context: string): ProxyChild {
  if (!Bun.which('kubectl')) throw new ProxyUnavailable('kubectl is not installed.');
  // `--context=` keeps a context name from being read as an option; the address is loopback only.
  return Bun.spawn(['kubectl', `--context=${context}`, 'proxy', '--port=0', '--address=127.0.0.1'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true });
}

async function readPort(stdout: ReadableStream<Uint8Array>, timeoutMs: number): Promise<number> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProxyUnavailable('kubectl proxy did not start in time.')), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) throw new ProxyUnavailable('kubectl proxy exited before it started.');
      seen += decoder.decode(value, { stream: true });
      const port = parseProxyPort(seen);
      if (port !== undefined) return port;
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // A read still pending after a timeout; the child is killed by the caller.
    }
  }
}

/** One `kubectl proxy` child per context, started on first use, restarted after it dies, stopped when idle or on exit. */
export class KubeProxy {
  private readonly entries = new Map<string, Entry>();
  private readonly spawn: (context: string) => ProxyChild;
  private readonly fetchFn: NonNullable<KubeProxyOptions['fetch']>;
  private readonly startTimeoutMs: number;
  private readonly idleMs: number;

  constructor(opts: KubeProxyOptions = {}) {
    this.spawn = opts.spawn ?? spawnProxy;
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.startTimeoutMs = opts.startTimeoutMs ?? START_TIMEOUT_MS;
    this.idleMs = opts.idleMs ?? IDLE_MS;
  }

  /** Whether a child is running or starting for `context`. */
  has(context: string): boolean {
    return this.entries.has(context);
  }

  private drop(context: string, entry: Entry): void {
    if (entry.dropped) return;
    entry.dropped = true;
    if (this.entries.get(context) === entry) this.entries.delete(context);
    clearTimeout(entry.timer);
    try {
      entry.child.kill();
    } catch {
      // Already gone.
    }
  }

  private touch(context: string, entry: Entry): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.drop(context, entry), this.idleMs);
    (entry.timer as { unref?: () => void }).unref?.();
  }

  /** The base URL of the context's proxy; concurrent callers share one start. */
  private acquire(context: string): { entry: Entry; base: Promise<string> } {
    let entry = this.entries.get(context);
    if (!entry) {
      let child: ProxyChild;
      try {
        child = this.spawn(context);
      } catch (err) {
        throw err instanceof ProxyUnavailable ? err : new ProxyUnavailable(String((err as Error)?.message ?? err));
      }
      const created: Entry = { child, base: readPort(child.stdout, this.startTimeoutMs).then((port) => `http://127.0.0.1:${port}`) };
      entry = created;
      this.entries.set(context, created);
      created.base.catch(() => this.drop(context, created));
      child.exited.then(
        () => this.drop(context, created),
        () => this.drop(context, created),
      );
    }
    this.touch(context, entry);
    return { entry, base: entry.base };
  }

  /** GETs `path` (from `kubePaths`) through the context's proxy and parses the JSON. Throws `ProxyUnavailable` on a connection problem, `ProxyHttpError` on an API error. */
  async apiGet(context: string, path: string, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const { entry, base } = this.acquire(context);
    const timeout = AbortSignal.timeout(timeoutMs);
    let status: number;
    let body: string;
    try {
      const url = (await base) + path;
      const res = await this.fetchFn(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: 'application/json' } });
      status = res.status;
      body = await res.text();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeout.aborted) throw new Error('The cluster did not answer: the request timed out.');
      throw err instanceof ProxyUnavailable ? err : new ProxyUnavailable(String((err as Error)?.message ?? err));
    }
    this.touch(context, entry);
    if (status < 200 || status >= 300) throw new ProxyHttpError(status, httpErrorMessage(status, body));
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('The cluster returned an invalid response.');
    }
  }

  /** Stops every child. */
  close(): void {
    for (const [context, entry] of [...this.entries]) this.drop(context, entry);
  }
}

export const kubeProxy = new KubeProxy();

process.on('exit', () => kubeProxy.close());
