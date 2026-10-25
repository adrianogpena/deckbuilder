import { describe, expect, test } from 'bun:test';
import { DEFAULT_TICKET_PATTERN } from '../github/map';
import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import { linkTickets, podKey, podsStage, prStage } from './linker';

const pr = (over: Partial<TrackedPr> = {}): TrackedPr => ({
  owner: 'o',
  repo: 'r',
  number: 1,
  title: 'ABC-1 change',
  url: 'u',
  state: 'open',
  draft: false,
  branch: 'feature/abc-1-x',
  labels: [],
  reviewDecision: null,
  changesRequested: false,
  checks: { state: 'passed', passed: 3, total: 3, details: [] },
  ready: false,
  rc: false,
  scope: 'mine',
  ...over,
});

const pod = (name: string, healthy = true): Pod =>
  ({ cluster: 'c/n', context: 'c', namespace: 'n', name, status: healthy ? 'Running' : 'Error', healthy, ready: '1/1', restarts: 0, lastRestartAt: '', startedAt: '', images: [], labels: {}, urls: [] });

describe('stages', () => {
  test('pr stage', () => {
    expect(prStage([])).toBe('none');
    expect(prStage([pr()])).toBe('ok');
    expect(prStage([pr({ draft: true })])).toBe('pending');
    expect(prStage([pr({ reviewDecision: 'REVIEW_REQUIRED' })])).toBe('pending');
    expect(prStage([pr({ changesRequested: true })])).toBe('fail');
    expect(prStage([pr({ checks: { state: 'failed', passed: 1, total: 3, details: [] } })])).toBe('fail');
    expect(prStage([pr({ state: 'merged' })])).toBe('ok');
    expect(prStage([pr({ state: 'closed' })])).toBe('warn');
  });
  test('pods stage', () => {
    expect(podsStage([])).toBe('none');
    expect(podsStage([pod('a')])).toBe('ok');
    expect(podsStage([pod('a', false)])).toBe('fail');
    expect(podsStage([pod('a'), pod('b', false)])).toBe('warn');
  });
});

describe('linkTickets', () => {
  test('links by upper-cased key and reports unlinked', () => {
    const { links, unlinked } = linkTickets(
      ['ABC-1'],
      [pr(), pr({ number: 2, title: 'other', branch: 'xyz-9-y', scope: 'review' })],
      [pod('abc-1-api-7f'), pod('xyz-9-api')],
      { 'abc-1': 2.5 },
      DEFAULT_TICKET_PATTERN,
    );
    const l = links['ABC-1']!;
    expect(l.branches).toEqual(['feature/abc-1-x']);
    expect(l.stages).toEqual({ branch: 'ok', pr: 'ok', pods: 'ok', hours: 'ok' });
    expect(l.hours).toBe(2.5);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]!.key).toBe('XYZ-9');
    expect(unlinked[0]!.scopes).toEqual(['review']);
    expect(unlinked[0]!.pods).toHaveLength(1);
  });
  test('links a pod by hand', () => {
    const p = pod('api-overwrite');
    const { links, unlinked } = linkTickets(['ABC-3'], [], [p, pod('abc-4-api')], {}, DEFAULT_TICKET_PATTERN, { 'ABC-3': ['c/n/api-overwrite'] });
    expect(links['ABC-3']!.pods).toEqual([p]);
    expect(links['ABC-3']!.manualPods).toEqual(['c/n/api-overwrite']);
    expect(unlinked.map((u) => u.key)).toEqual(['ABC-4']);
  });
  test('nothing linked', () => {
    const { links } = linkTickets(['ABC-2'], [], [], {}, DEFAULT_TICKET_PATTERN);
    expect(links['ABC-2']!.stages).toEqual({ branch: 'none', pr: 'none', pods: 'none', hours: 'none' });
  });
  test('pod key anywhere in the name', () => {
    expect(podKey('abc-1-x', DEFAULT_TICKET_PATTERN)).toBe('ABC-1');
    expect(podKey('svc-abc-1', DEFAULT_TICKET_PATTERN)).toBe('ABC-1');
    expect(podKey('svc-api', DEFAULT_TICKET_PATTERN)).toBe('');
  });
});
