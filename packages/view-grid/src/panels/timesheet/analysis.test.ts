import { describe, expect, test } from 'bun:test';
import {
  activeHours, applyLocks, buildDays, collapseCopilotWorktree, copilotRecords, createClaudeScan, encodeRoot, isTracked,
  makeTicketFinder, NO_TICKET, parseSimpleYaml, toggleLock, weekBounds, weekTotals, type TimesheetData,
} from './analysis';

const find = makeTicketFinder('[A-Z][A-Z0-9]+-\\d+');
const MIN = 60_000;
const at = (day: string, hh: number, mm: number): number => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
const iso = (ms: number): string => new Date(ms).toISOString();

describe('week and tickets', () => {
  test('weekBounds from a Wednesday and a Sunday', () => {
    expect(weekBounds(new Date(2026, 9, 21)).days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(weekBounds(new Date(2026, 9, 25)).monday).toBe('2026-10-19');
  });

  test('ticket finder is case-insensitive and upper-cases', () => {
    expect(find('feature/vwde-25456-analysis')).toBe('VWDE-25456');
    expect(find('VWDE-1a done')).toBe('VWDE-1');
    expect(find('main')).toBeNull();
    expect(makeTicketFinder('(')('x')).toBeNull();
  });

  test('activeHours caps each gap at 15 minutes', () => {
    expect(activeHours([0, 10 * MIN, 70 * MIN])).toBeCloseTo(25 / 60, 5);
    expect(activeHours([5])).toBe(0);
  });

  test('roots and paths', () => {
    expect(encodeRoot('C:\\Work\\app')).toBe('C--WORK-APP');
    expect(isTracked('c:/work/app/sub', ['C:\\Work\\app'])).toBe(true);
    expect(isTracked('D:/x', ['C:\\Work\\app'])).toBe(false);
    expect(collapseCopilotWorktree('C:/S/copilot-worktrees/repo/slug')).toBe('C:/S/repo');
  });

  test('yaml block scalars are joined', () => {
    expect(parseSimpleYaml('cwd: C:/a\nname: |-\n  one\n  two\nbranch: "x"\n')).toEqual({ cwd: 'C:/a', name: 'one two', branch: 'x' });
  });
});

describe('claude and copilot records', () => {
  const week = weekBounds(new Date(2026, 9, 21));
  const inWeek = (d: string) => d >= week.monday && d <= week.days[4]!;
  const line = (o: object) => JSON.stringify(o);

  test('ticket from the branch, falling back to titles; untracked cwd skipped', () => {
    const scan = createClaudeScan(['C:/work'], find, inWeek);
    const t = at('2026-10-20', 9, 0);
    scan.feed(line({ type: 'user', timestamp: iso(t), cwd: 'C:\\work\\app', gitBranch: 'main' }));
    scan.feed('not json');
    scan.feed(line({ type: 'ai-title', aiTitle: 'Fix ABC-12 bug' }));
    scan.feed(line({ type: 'user', timestamp: iso(t + MIN), cwd: 'C:\\work\\app' }));
    scan.feed(line({ type: 'user', timestamp: iso(t + 2 * MIN), cwd: 'D:\\other' }));
    scan.feed(line({ type: 'user', timestamp: iso(at('2026-10-10', 9, 0)), cwd: 'C:\\work\\app' }));
    const { records, cwd } = scan.result();
    expect(records.map((r) => r.ticket)).toEqual(['ABC-12', 'ABC-12']);
    expect(cwd).toBe('C:\\work\\app');
  });

  test('copilot events get the session ticket', () => {
    const t = at('2026-10-21', 10, 0);
    const recs = copilotRecords([line({ timestamp: iso(t) }), line({ nope: 1 }), '', line({ timestamp: iso(t + MIN) })], 'ABC-1', inWeek);
    expect(recs).toHaveLength(2);
    expect(recs[0]!.ticket).toBe('ABC-1');
  });
});

describe('days and locks', () => {
  const bounds = weekBounds(new Date(2026, 9, 21));
  const [mon, tue, wed] = bounds.days as [string, string, string, string, string];

  test('buildDays sums hours per day and ticket, attaches commits, keeps the no-ticket bucket', () => {
    const records = [
      { ts: at(mon, 9, 0), ticket: 'A-1' },
      { ts: at(mon, 9, 10), ticket: 'A-1' },
      { ts: at(tue, 9, 0), ticket: null },
      { ts: at(tue, 9, 30), ticket: null },
    ];
    const days = buildDays(records, [{ day: mon, ticket: 'A-1' }, { day: mon, ticket: 'Z-9' }, { day: tue, ticket: null }], bounds.days);
    expect(days[mon]).toEqual({ 'A-1': { hours: 0.17, commits: 1 } });
    expect(days[tue]).toEqual({ [NO_TICKET]: { hours: 0.25, commits: 1 } });
    expect(days[wed]).toEqual({});
  });

  const stored: TimesheetData = {
    week: bounds.monday,
    days: { [mon]: { 'A-1': { hours: 1, commits: 0 } }, [tue]: { 'A-1': { hours: 2, commits: 0 } } },
    lockedDays: [mon],
  };
  const fresh = { [mon]: { 'A-1': { hours: 5, commits: 0 } }, [tue]: { 'A-1': { hours: 6, commits: 0 } }, [wed]: { 'A-1': { hours: 7, commits: 0 } } };

  test('locked past day keeps data, unlocked past day refreshes once and locks, today is fresh', () => {
    const out = applyLocks(stored, fresh, bounds, wed);
    expect(out.days[mon]!['A-1']!.hours).toBe(1);
    expect(out.days[tue]!['A-1']!.hours).toBe(6);
    expect(out.days[wed]!['A-1']!.hours).toBe(7);
    expect(out.lockedDays).toEqual([mon, tue]);
    expect(weekTotals(out)).toEqual({ 'A-1': 14 });
  });

  test('another week is discarded', () => {
    const out = applyLocks({ ...stored, week: '2026-10-12' }, fresh, bounds, wed);
    expect(out.days[mon]!['A-1']!.hours).toBe(5);
  });

  test('toggle only for past days of the stored week', () => {
    expect(toggleLock(stored, mon, bounds, wed).lockedDays).toEqual([]);
    expect(toggleLock(stored, tue, bounds, wed).lockedDays).toEqual([mon, tue]);
    expect(toggleLock(stored, wed, bounds, wed)).toBe(stored);
  });
});
