import { describe, expect, test } from 'bun:test';
import type { TrackedPr } from '../github/tracked';
import { planAutoMoves, ruleTriggers } from './auto-move';
import type { Ticket } from './model';
import type { TicketLink } from './types';

const pr = (over: Partial<TrackedPr> = {}): TrackedPr =>
  ({ owner: 'o', repo: 'r', number: 1, title: '', url: 'u', state: 'open', draft: false, branch: '', labels: [], reviewDecision: null, changesRequested: false, checks: { state: 'none', passed: 0, total: 0, details: [] }, ready: false, rc: false, ...over }) as TrackedPr;

const link = (prs: TrackedPr[]): TicketLink => ({ stages: { branch: 'none', pr: 'none', pods: 'none', hours: 'none' }, branches: [], prs, pods: [], hours: null });
const ticket = (status: string, autoMove: boolean | null = null): Ticket => ({ id: 'a', key: 'A-1', description: '', status, autoMove, order: 0 });
const statuses = ['Open', 'In Review', 'Ready to Merge', 'Done'];

describe('ruleTriggers', () => {
  test('open non-draft PR', () => {
    expect(ruleTriggers([pr()], 'ready to merge')).toEqual(['open-pr']);
    expect(ruleTriggers([pr({ draft: true })], 'ready to merge')).toEqual([]);
  });
  test('ready label, case-insensitive substring', () => {
    expect(ruleTriggers([pr({ labels: ['Ready To Merge now'] })], 'ready to merge')).toEqual(['open-pr', 'ready-to-merge']);
  });
  test('merged only when none open; closed ignored', () => {
    expect(ruleTriggers([pr({ state: 'merged' })], 'x')).toEqual(['merged']);
    expect(ruleTriggers([pr({ state: 'merged' }), pr({ state: 'open', draft: true })], 'x')).toEqual([]);
    expect(ruleTriggers([pr({ state: 'closed' })], 'x')).toEqual([]);
  });
});

describe('planAutoMoves', () => {
  test('moves right, furthest target, once', () => {
    const links = { 'A-1': link([pr({ labels: ['ready to merge'] })]) };
    const first = planAutoMoves([ticket('Open')], links, statuses, {}, true);
    expect(first.moves).toEqual([{ id: 'a', status: 'Ready to Merge' }]);
    expect(planAutoMoves([ticket('Open')], links, statuses, first.memory, true).moves).toEqual([]);
  });
  test('never moves left or when off; memory still updated', () => {
    const links = { 'A-1': link([pr()]) };
    expect(planAutoMoves([ticket('Done')], links, statuses, {}, true).moves).toEqual([]);
    const off = planAutoMoves([ticket('Open', false)], links, statuses, {}, true);
    expect(off.moves).toEqual([]);
    expect(off.memory['A-1']).toEqual(['open-pr']);
    expect(planAutoMoves([ticket('Open')], links, statuses, {}, false).moves).toEqual([]);
    expect(planAutoMoves([ticket('Open', true)], links, statuses, {}, false).moves).toHaveLength(1);
  });
  test('unknown current status is left alone', () => {
    expect(planAutoMoves([ticket('Gone')], { 'A-1': link([pr()]) }, statuses, {}, true).moves).toEqual([]);
  });
});
