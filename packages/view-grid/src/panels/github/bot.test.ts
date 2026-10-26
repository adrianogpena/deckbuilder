import { expect, test } from 'bun:test';
import { parseBotComments, parseBotWarnings } from './bot';
import { RC_MARKER } from './rc';

const deps = ['## Dependency check', '', '> [!WARNING]', '> Not allowed dependency versions:', '> - `foo` 1.0 is [blocked](http://x)', '> - bar 2.0', '', 'done'].join('\n');
const jira = [
  '## Jira Status Checks [BETA] - Failed!',
  '',
  ':x: VWDE-24838 Incorrect Issue Status. Should be in status "TSYS Validated"',
  ':white_check_mark: VWDE-1 ok',
  'Merge authorization not found.',
].join('\n');

test('alert block lines are extracted as plain text', () => {
  expect(parseBotWarnings(deps)).toEqual(['Not allowed dependency versions:', 'foo 1.0 is blocked', 'bar 2.0']);
});

test('status comments yield failing lines but not the heading', () => {
  expect(parseBotWarnings(jira)).toEqual(['❌ VWDE-24838 Incorrect Issue Status. Should be in status "TSYS Validated"', 'Merge authorization not found.']);
});

test('entries carry label, time and link; clean comments are dropped', () => {
  const list = parseBotComments([
    { body: deps, updatedAt: '2026-01-01T00:00:00Z', url: 'u1' },
    { body: jira, updatedAt: '2026-01-02T00:00:00Z', url: 'u2' },
    { body: '## All good', updatedAt: '2026-01-03T00:00:00Z', url: 'u3' },
  ]);
  expect(list.map((e) => [e.source, e.url])).toEqual([['Dependency check', 'u1'], ['Jira Status Checks [BETA] - Failed!', 'u2']]);
  expect(list[0]?.updatedAt).toBe('2026-01-01T00:00:00Z');
});

test('only the latest RC comment is kept and only its alerts count', () => {
  const rc = (n: string) => `<!-- ${RC_MARKER} -->\n### mod\n> [!WARNING]\n> warn ${n}\n| a | ❌ |`;
  const list = parseBotComments([
    { body: rc('old'), updatedAt: 'a', url: 'u1' },
    { body: rc('new'), updatedAt: 'b', url: 'u2' },
  ]);
  expect(list).toHaveLength(1);
  expect(list[0]?.lines).toEqual(['warn new']);
  expect(list[0]?.url).toBe('u2');
});
