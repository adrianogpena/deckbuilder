import { describe, expect, test } from 'bun:test';
import { parseMetrics, podOverview, sanitizePod } from './detail';

const pod = {
  metadata: {
    name: 'api-1',
    creationTimestamp: '2026-01-01T00:00:00Z',
    labels: { app: 'api' },
    annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}', note: 'x' },
    managedFields: [{ manager: 'k' }],
    ownerReferences: [{ kind: 'ReplicaSet', name: 'api-rs', controller: true }],
  },
  spec: {
    nodeName: 'node-1',
    initContainers: [{ name: 'init', image: 'i:1' }],
    containers: [
      { name: 'a', image: 'a:1', resources: { requests: { cpu: '100m', memory: '64Mi' }, limits: { cpu: '1', memory: '128Mi' } } },
      { name: 'b', image: 'b:1', resources: { requests: { cpu: '200m', memory: '64Mi' } } },
    ],
  },
  status: {
    phase: 'Running',
    podIP: '10.0.0.1',
    hostIP: '10.0.0.2',
    qosClass: 'Burstable',
    conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: 't' }],
    initContainerStatuses: [{ name: 'init', ready: true, state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
    containerStatuses: [
      { name: 'a', ready: true, restartCount: 1, state: { running: {} }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: 'f' } } },
      { name: 'b', ready: false, restartCount: 0, state: { waiting: { reason: 'X', message: 'msg' } } },
    ],
  },
};

describe('sanitizePod', () => {
  test('drops managedFields and last-applied without mutating', () => {
    const clean = sanitizePod(pod);
    expect(clean.metadata.managedFields).toBeUndefined();
    expect(clean.metadata.annotations).toEqual({ note: 'x' });
    expect(pod.metadata.managedFields).toHaveLength(1);
  });
});

describe('parseMetrics', () => {
  test('converts units per container', () => {
    const u = parseMetrics({ containers: [{ name: 'a', usage: { cpu: '250m', memory: '1Mi' } }, { name: 'b', usage: { cpu: '500000u', memory: '1Gi' } }] });
    expect(u?.containers.a).toEqual({ cpu: 0.25, memory: 2 ** 20 });
    expect(u?.cpu).toBeCloseTo(0.75);
    expect(u?.memory).toBe(2 ** 20 + 2 ** 30);
  });
  test('no containers is undefined', () => {
    expect(parseMetrics({})).toBeUndefined();
  });
});

describe('podOverview', () => {
  const usage = parseMetrics({ containers: [{ name: 'a', usage: { cpu: '10m', memory: '1Mi' } }] });
  const o = podOverview(pod, usage, Date.parse('2026-01-01T00:01:00Z'));
  test('header fields', () => {
    expect(o).toMatchObject({ ageMs: 60000, node: 'node-1', podIP: '10.0.0.1', hostIP: '10.0.0.2', qosClass: 'Burstable', owner: 'ReplicaSet/api-rs', status: 'X', tone: 'info' });
    expect(o.annotations).toEqual({ note: 'x' });
  });
  test('init containers come first', () => {
    expect(o.containers.map((c) => [c.name, c.init])).toEqual([['init', true], ['a', false], ['b', false]]);
    expect(o.containers[1]).toMatchObject({ state: 'Running', tone: 'ok', restarts: 1, lastTerminated: { reason: 'OOMKilled', exitCode: 137, finishedAt: 'f' }, usage: { cpu: 0.01 } });
    expect(o.containers[2]).toMatchObject({ state: 'X', message: 'msg', tone: 'warn' });
  });
  test('totals count only when every container defines it', () => {
    expect(o.totals.requests.cpu).toBeCloseTo(0.3);
    expect(o.totals.limits).toEqual({ cpu: 0, memory: 0 });
    expect(o.conditions[0]).toMatchObject({ type: 'Ready', status: 'True' });
  });
});
