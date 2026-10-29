import { describe, expect, test } from 'bun:test';
import {
  buildDays, collapseCopilotWorktree, copilotRecords, createClaudeScan, dayHours, encodeRoot, isTracked,
  knownPrefixes, makeTicketFinder, NO_TICKET, parseSimpleYaml, resolveSession, splitRoots, weekBounds, type ClaudeSession,
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

  test('roots and paths', () => {
    expect(encodeRoot('C:\\Work\\app')).toBe('C--WORK-APP');
    expect(isTracked('c:/work/app/sub', ['C:\\Work\\app'])).toBe(true);
    expect(isTracked('D:/x', ['C:\\Work\\app'])).toBe(false);
    expect(collapseCopilotWorktree('C:/S/copilot-worktrees/repo/slug')).toBe('C:/S/repo');
    expect(splitRoots('/x/Source/\n/mnt/c/Work\nD:\\a\n/x')).toEqual(['X:/Source/', 'C:/Work', 'D:/a', 'X:/']);
    expect(encodeRoot(splitRoots('/x/Source/')[0]!)).toBe('X--SOURCE-');
  });

  test('yaml block scalars are joined', () => {
    expect(parseSimpleYaml('cwd: C:/a\nname: |-\n  one\n  two\nbranch: "x"\n')).toEqual({ cwd: 'C:/a', name: 'one two', branch: 'x' });
  });
});

describe('claude and copilot records', () => {
  const week = weekBounds(new Date(2026, 9, 21));
  const inWeek = (d: string) => d >= week.monday && d <= week.days[4]!;
  const line = (o: object) => JSON.stringify(o);

  test('records keep the branch ticket; titles are kept for the fallback; untracked cwd skipped', () => {
    const scan = createClaudeScan(['C:/work'], find, inWeek);
    const t = at('2026-10-20', 9, 0);
    scan.feed(line({ type: 'user', timestamp: iso(t), cwd: 'C:\\work\\app', gitBranch: 'main' }));
    scan.feed('not json');
    scan.feed(line({ type: 'ai-title', aiTitle: 'Fix ABC-12 bug' }));
    scan.feed(line({ type: 'user', timestamp: iso(t + MIN), cwd: 'C:\\work\\app', gitBranch: 'feature/abc-9' }));
    scan.feed(line({ type: 'user', timestamp: iso(t + 2 * MIN), cwd: 'D:\\other' }));
    scan.feed(line({ type: 'user', timestamp: iso(at('2026-10-10', 9, 0)), cwd: 'C:\\work\\app' }));
    const s = scan.result();
    expect(s.records.map((r) => r.ticket)).toEqual([null, 'ABC-9']);
    expect(s.ai).toBe('ABC-12');
    expect(s.cwd).toBe('C:\\work\\app');
  });

  test('typed prompts and the folder give keys; tool results and subagent prompts do not', () => {
    const scan = createClaudeScan(['C:/work'], find, inWeek);
    const t = at('2026-10-20', 9, 0);
    scan.feed(line({ type: 'user', timestamp: iso(t), cwd: 'C:\\work\\app-XY-7', message: { content: 'look at abc-3 please' } }));
    scan.feed(line({ type: 'user', timestamp: iso(t), message: { content: [{ type: 'tool_result', content: 'DEF-1' }] } }));
    scan.feed(line({ type: 'user', isSidechain: true, timestamp: iso(t), message: { content: 'GHI-2' } }));
    scan.feed(line({ type: 'user', timestamp: iso(t), origin: { kind: 'human' }, message: { content: [{ type: 'text', text: 'and JKL-4' }] } }));
    const s = scan.result();
    expect(s.prompts).toEqual(['ABC-3', 'JKL-4']);
    expect(s.folder).toBe('XY-7');
  });

  test('copilot events get the session ticket', () => {
    const t = at('2026-10-21', 10, 0);
    const recs = copilotRecords([line({ timestamp: iso(t) }), line({ nope: 1 }), '', line({ timestamp: iso(t + MIN) })], 'ABC-1', inWeek);
    expect(recs).toHaveLength(2);
    expect(recs[0]!.ticket).toBe('ABC-1');
  });
});

describe('days', () => {
  const bounds = weekBounds(new Date(2026, 9, 21));
  const [mon, tue, wed] = bounds.days as [string, string, string, string, string];

  test('buildDays sums hours per day and ticket, attaches commits, keeps the no-ticket bucket', () => {
    const records = [
      { ts: at(mon, 9, 0), ticket: 'A-1' },
      { ts: at(mon, 9, 10), ticket: 'A-1' },
      { ts: at(tue, 9, 0), ticket: null },
      { ts: at(tue, 9, 30), ticket: null },
    ];
    const days = buildDays(records, [{ day: mon, ticket: 'A-1' }, { day: mon, ticket: 'Z-9' }, { day: tue, ticket: null }], bounds.days, 15 * MIN);
    expect(days[mon]).toEqual({ 'A-1': { hours: 0.17, commits: 1 } });
    expect(days[tue]).toEqual({ [NO_TICKET]: { hours: 0, commits: 1 } });
    expect(days[wed]).toEqual({});
  });

  const every = (ticket: string, from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => ({ ts: from + i * step, ticket }));

  test('a break counts nothing: an hour in the morning and one in the evening make two', () => {
    const recs = [...every('A-1', at(mon, 9, 0), at(mon, 10, 0), 5 * MIN), ...every('A-1', at(mon, 17, 0), at(mon, 18, 0), 5 * MIN)];
    expect(dayHours(recs, 15 * MIN).get('A-1')).toBeCloseTo(2, 5);
  });

  test('parallel sessions share one timeline and a switch gap goes to the earlier ticket', () => {
    const recs = [...every('A-1', at(mon, 9, 0), at(mon, 10, 0), 2 * MIN), ...every('B-1', at(mon, 9, 1), at(mon, 9, 59), 2 * MIN)];
    const h = dayHours(recs, 15 * MIN);
    expect((h.get('A-1') ?? 0) + (h.get('B-1') ?? 0)).toBeCloseTo(1, 5);
    const sw = dayHours([{ ts: at(mon, 9, 0), ticket: 'A-1' }, { ts: at(mon, 9, 10), ticket: 'B-1' }], 15 * MIN);
    expect(sw.get('A-1')).toBeCloseTo(10 / 60, 5);
    expect(sw.get('B-1')).toBe(0);
  });
});

describe('session fallback', () => {
  const session = (o: Partial<ClaudeSession>): ClaudeSession => ({ records: [], custom: null, ai: null, prompts: [], folder: null, cwd: 'C:/w', ...o });
  const recs = (...tickets: (string | null)[]) => tickets.map((ticket, i) => ({ ts: i, ticket }));
  const tickets = (s: ClaudeSession, known: string[]) => resolveSession(s, new Set(known)).map((r) => r.ticket);

  test('order: branch, custom title, main branch ticket, prompt, folder, generated title', () => {
    expect(tickets(session({ records: recs('A-1', null), custom: 'C-1' }), [])).toEqual(['A-1', 'C-1']);
    expect(tickets(session({ records: recs('A-1', 'B-1', 'B-1', null), prompts: ['P-1'] }), ['P'])).toEqual(['A-1', 'B-1', 'B-1', 'B-1']);
    expect(tickets(session({ records: recs(null), prompts: ['UTF-8', 'P-1'], folder: 'F-1', ai: 'G-1' }), ['P', 'F', 'G'])).toEqual(['P-1']);
    expect(tickets(session({ records: recs(null), folder: 'F-1', ai: 'G-1' }), ['F', 'G'])).toEqual(['F-1']);
    expect(tickets(session({ records: recs(null), folder: 'TEST-12', ai: 'G-1' }), ['G'])).toEqual(['G-1']);
    expect(tickets(session({ records: recs(null), prompts: ['UTF-8'], ai: 'G-1' }), [])).toEqual([null]);
  });

  test('known prefixes come from branches, custom titles and commits only', () => {
    const known = knownPrefixes([session({ records: recs('VWDE-1'), custom: 'AB-2', ai: 'NO-3', prompts: ['NO-4'] })], [{ day: 'x', ticket: 'CD-5' }, { day: 'x', ticket: null }]);
    expect([...known].sort()).toEqual(['AB', 'CD', 'VWDE']);
  });
});
