import { describe, expect, test } from 'bun:test';
import { classifyStderr } from './kube-errors';
import { httpErrorMessage, KubeProxy, kubePaths, parseProxyPort, ProxyHttpError, ProxyUnavailable, type ProxyChild } from './proxy';

describe('parseProxyPort', () => {
  test('reads the port of the serving line', () => {
    expect(parseProxyPort('Starting to serve on 127.0.0.1:54321\n')).toBe(54321);
  });
  test('waits for the whole line', () => {
    expect(parseProxyPort('Starting to serve on 127.0.0.1:543')).toBeUndefined();
    expect(parseProxyPort('')).toBeUndefined();
  });
});

describe('kubePaths', () => {
  test('builds API paths', () => {
    expect(kubePaths.pods('ns1')).toBe('/api/v1/namespaces/ns1/pods');
    expect(kubePaths.pod('ns1', 'web-1')).toBe('/api/v1/namespaces/ns1/pods/web-1');
    expect(kubePaths.ingresses('ns1')).toBe('/apis/networking.k8s.io/v1/namespaces/ns1/ingresses');
    expect(kubePaths.podMetrics('ns1', 'web-1')).toBe('/apis/metrics.k8s.io/v1beta1/namespaces/ns1/pods/web-1');
  });
  test('rejects names that are not DNS labels', () => {
    expect(() => kubePaths.pods('../x')).toThrow();
    expect(() => kubePaths.pod('ns', 'a/b')).toThrow();
    expect(() => kubePaths.pod('ns', 'a?b=1')).toThrow();
    expect(() => kubePaths.pods('')).toThrow();
  });
});

describe('httpErrorMessage', () => {
  const status = (reason: string, message: string) => JSON.stringify({ kind: 'Status', reason, message });
  test('maps to the kubectl error classes', () => {
    expect(classifyStderr(httpErrorMessage(403, status('Forbidden', 'pods is forbidden: User "x" cannot list resource "pods"'))).code).toBe('forbidden');
    expect(classifyStderr(httpErrorMessage(401, status('Unauthorized', 'Unauthorized'))).code).toBe('credentialsRejected');
    expect(classifyStderr(httpErrorMessage(404, status('NotFound', 'pods "x" not found'))).code).toBe('notfound');
    expect(classifyStderr(httpErrorMessage(502, 'dial tcp 10.0.0.1:443: connect: connection refused')).code).toBe('unreachable');
    expect(classifyStderr(httpErrorMessage(502, '')).code).toBe('unreachable');
    expect(classifyStderr(httpErrorMessage(503, '')).code).toBe('unreachable');
  });
  test('falls back to the status name for an empty body', () => {
    expect(httpErrorMessage(401, '')).toBe('Error from server (Unauthorized): Unauthorized');
  });
});

function fakeChild(lines: string[] = ['Starting to serve on 127.0.0.1:4000\n']) {
  let kills = 0;
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => (exit = resolve));
  const enc = new TextEncoder();
  const child: ProxyChild = {
    stdout: new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
      },
    }),
    exited,
    kill: () => {
      kills++;
      exit(0);
    },
  };
  return { child, kills: () => kills, die: () => exit(1) };
}

const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe('KubeProxy', () => {
  test('shares one start per context and reuses it', async () => {
    let spawned = 0;
    const urls: string[] = [];
    const proxy = new KubeProxy({
      spawn: () => (spawned++, fakeChild().child),
      fetch: async (url) => (urls.push(url), new Response('{"a":1}')),
    });
    const [a, b] = await Promise.all([proxy.apiGet('c1', '/api/v1/x'), proxy.apiGet('c1', '/api/v1/y')]);
    await proxy.apiGet('c1', '/api/v1/z');
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ a: 1 });
    expect(spawned).toBe(1);
    expect(urls[0]).toBe('http://127.0.0.1:4000/api/v1/x');
    proxy.close();
  });

  test('restarts after the child died', async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const proxy = new KubeProxy({
      spawn: () => {
        const f = fakeChild();
        children.push(f);
        return f.child;
      },
      fetch: ok({}),
    });
    await proxy.apiGet('c1', '/p');
    children[0]!.die();
    await Bun.sleep(5);
    expect(proxy.has('c1')).toBe(false);
    await proxy.apiGet('c1', '/p');
    expect(children).toHaveLength(2);
    proxy.close();
  });

  test('kills the child when idle and on close', async () => {
    const f = fakeChild();
    const proxy = new KubeProxy({ spawn: () => f.child, fetch: ok({}), idleMs: 10 });
    await proxy.apiGet('c1', '/p');
    await Bun.sleep(40);
    expect(f.kills()).toBe(1);
    expect(proxy.has('c1')).toBe(false);

    const g = fakeChild();
    const open = new KubeProxy({ spawn: () => g.child, fetch: ok({}) });
    await open.apiGet('c1', '/p');
    open.close();
    expect(g.kills()).toBe(1);
  });

  test('a proxy that exits or hangs before serving is unavailable', async () => {
    const early = new KubeProxy({ spawn: () => fakeChild([]).child, fetch: ok({}), startTimeoutMs: 20 });
    await expect(early.apiGet('c1', '/p')).rejects.toBeInstanceOf(ProxyUnavailable);
    expect(early.has('c1')).toBe(false);
    const throws = new KubeProxy({
      spawn: () => {
        throw new Error('no kubectl');
      },
    });
    await expect(throws.apiGet('c1', '/p')).rejects.toBeInstanceOf(ProxyUnavailable);
  });

  test('a connection failure is unavailable, an API error is not', async () => {
    const down = new KubeProxy({
      spawn: () => fakeChild().child,
      fetch: async () => {
        throw new TypeError('Unable to connect');
      },
    });
    await expect(down.apiGet('c1', '/p')).rejects.toBeInstanceOf(ProxyUnavailable);
    down.close();

    const forbidden = new KubeProxy({ spawn: () => fakeChild().child, fetch: ok({ reason: 'Forbidden', message: 'pods is forbidden' }, 403) });
    const err = (await forbidden.apiGet('c1', '/p').catch((e) => e)) as ProxyHttpError;
    expect(err).toBeInstanceOf(ProxyHttpError);
    expect(err.status).toBe(403);
    expect(classifyStderr(err.message).code).toBe('forbidden');
    forbidden.close();
  });

  test('an abort rethrows as is', async () => {
    const proxy = new KubeProxy({
      spawn: () => fakeChild().child,
      fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    });
    const ctl = new AbortController();
    const p = proxy.apiGet('c1', '/p', ctl.signal);
    await Bun.sleep(5);
    ctl.abort();
    const err = await p.catch((e) => e);
    expect(err).not.toBeInstanceOf(ProxyUnavailable);
    proxy.close();
  });
});
