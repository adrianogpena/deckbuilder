import { describe, expect, test } from 'bun:test';
import { ingressUrls, isTracked, mapPods, parseClusters, podConfigMaps } from './model';

const cluster = { context: 'dev', namespace: 'apps', patterns: ['api', 'web'] };

const podsJson = {
  items: [
    {
      metadata: { name: 'api-7d9f-abc', labels: { app: 'api' } },
      spec: { containers: [{ image: 'reg/api:1' }, { image: 'reg/side:2' }] },
      status: {
        phase: 'Running',
        startTime: '2026-01-01T10:00:00Z',
        containerStatuses: [
          { ready: true, restartCount: 2, lastState: { terminated: { finishedAt: '2026-01-02T00:00:00Z' } }, state: { running: {} } },
          { ready: true, restartCount: 1, lastState: { terminated: { finishedAt: '2026-01-03T00:00:00Z' } }, state: { running: {} } },
        ],
      },
    },
    {
      metadata: { name: 'Web-1' },
      spec: { containers: [{ image: 'reg/web:1' }] },
      status: { phase: 'Running', containerStatuses: [{ ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
    },
    { metadata: { name: 'db-0' }, status: { phase: 'Running' } },
    {
      metadata: { name: 'api-job' },
      status: { phase: 'Succeeded', containerStatuses: [{ ready: false, state: { terminated: { reason: 'Completed' } } }] },
    },
  ],
};

describe('parseClusters', () => {
  test('parses lines and skips malformed ones', () => {
    const text = 'dev apps api,Web\n# note\n\nbad\nprod ns-1 x';
    expect(parseClusters(text)).toEqual([
      { context: 'dev', namespace: 'apps', patterns: ['api', 'web'] },
      { context: 'prod', namespace: 'ns-1', patterns: ['x'] },
    ]);
  });
  test('rejects an invalid namespace', () => {
    expect(parseClusters('dev Bad;ns api')).toEqual([]);
  });
});

describe('isTracked', () => {
  test('matches case-insensitive substrings', () => {
    expect(isTracked('My-API-1', ['api'])).toBe(true);
    expect(isTracked('db-0', ['api'])).toBe(false);
    expect(isTracked('db-0', [])).toBe(false);
  });
});

describe('mapPods', () => {
  const pods = mapPods(podsJson, cluster);
  test('keeps only tracked pods', () => {
    expect(pods.map((p) => p.name)).toEqual(['api-7d9f-abc', 'Web-1', 'api-job']);
  });
  test('healthy pod', () => {
    expect(pods[0]).toMatchObject({ status: 'Running', healthy: true, ready: '2/2', restarts: 3, lastRestartAt: '2026-01-03T00:00:00Z', cluster: 'dev/apps', images: ['reg/api:1', 'reg/side:2'] });
  });
  test('waiting reason is the status', () => {
    expect(pods[1]).toMatchObject({ status: 'CrashLoopBackOff', healthy: false, ready: '0/1', restarts: 5 });
  });
  test('Completed falls back to the phase', () => {
    expect(pods[2]).toMatchObject({ status: 'Succeeded', healthy: false });
  });
});

describe('ingressUrls', () => {
  const ingress = {
    items: [
      {
        spec: {
          tls: [{ hosts: ['api.example.com'] }],
          rules: [
            { host: 'api.example.com', http: { paths: [{ path: '/', backend: { service: { name: 'api' } } }] } },
            { host: 'other.example.com', http: { paths: [{ path: '/x', backend: { service: { name: 'other' } } }] } },
            { host: 'plain.example.com', http: { paths: [{ path: '/v1', backend: { service: { name: 'api' } } }] } },
          ],
        },
      },
    ],
  };
  test('matches by label value', () => {
    expect(ingressUrls(ingress, { app: 'api' })).toEqual(['https://api.example.com', 'http://plain.example.com/v1']);
  });
  test('matches by pod name prefix', () => {
    expect(ingressUrls(ingress, {}, 'other-5f-x')).toEqual(['http://other.example.com/x']);
  });
  test('no match', () => {
    expect(ingressUrls(ingress, { app: 'zzz' }, 'zzz-1')).toEqual([]);
  });
});

describe('podConfigMaps', () => {
  test('collects volumes, env and envFrom', () => {
    const pod = {
      spec: {
        volumes: [{ configMap: { name: 'cfg-a' } }, { secret: { secretName: 's' } }, { projected: { sources: [{ configMap: { name: 'cfg-b' } }] } }],
        containers: [{ envFrom: [{ configMapRef: { name: 'cfg-c' } }], env: [{ valueFrom: { configMapKeyRef: { name: 'cfg-a' } } }] }],
      },
    };
    expect(podConfigMaps(pod)).toEqual(['cfg-a', 'cfg-b', 'cfg-c']);
  });
});
