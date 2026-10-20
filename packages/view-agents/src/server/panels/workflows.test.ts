import { describe, expect, test } from 'bun:test';
import { parseJournal } from './workflows.ts';

const rec = (o: unknown) => JSON.stringify(o);

describe('parseJournal', () => {
  test('pairs started and result records by agent id', () => {
    const text = [
      rec({ type: 'launched' }),
      rec({ type: 'started', key: 'k1', agentId: 'a1', label: 'one', phase: 'Groups' }),
      rec({ type: 'started', key: 'k2', agentId: 'a2', label: 'two', phase: 'Review' }),
      rec({ type: 'result', key: 'k1', agentId: 'a1', result: { status: 'review', summary: 'did it' } }),
    ].join('\n');
    const run = parseJournal(text, 'wf_1', { updatedAt: 0 }, 1_000_000);
    expect(run.phases).toEqual(['Groups', 'Review']);
    expect(run.agents.map((a) => [a.label, a.status, a.summary])).toEqual([['one', 'done', 'did it'], ['two', 'running', undefined]]);
    expect(run.status).toBe('running');
    expect(run.name).toBe('one');
  });

  test('done when every agent has a result and the journal is idle; failed on an error result', () => {
    const ok = [rec({ type: 'started', agentId: 'a', label: 'x' }), rec({ type: 'result', agentId: 'a', result: 'fine' })].join('\n');
    expect(parseJournal(ok, 'w', { updatedAt: 0 }, 1_000_000).status).toBe('done');
    const bad = [rec({ type: 'started', agentId: 'a', label: 'x' }), rec({ type: 'result', agentId: 'a', result: { status: 'failed', error: 'boom' } }), 'not json'].join('\n');
    const run = parseJournal(bad, 'w', { updatedAt: 0 }, 1_000_000);
    expect(run.status).toBe('failed');
    expect(run.agents[0]?.summary).toBe('boom');
  });
});
