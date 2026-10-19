import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, createTaskStore, isTaskList, type TaskItem } from './task.ts';

const use = (id: string, input: unknown) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'ExitPlanMode', input }] } });
const result = (id: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const text = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } });

test('capturePlan returns the newest ExitPlanMode plan, unanswered while no result follows', () => {
  expect(capturePlan([text].join('\n'))).toBeNull();
  expect(capturePlan([text, use('a', { plan: '# One' })].join('\n'))).toEqual({ plan: '# One', answered: false });
  expect(capturePlan([use('a', { plan: '# One' }), result('a'), use('b', { plan: '# Two' })].join('\n'))).toEqual({ plan: '# Two', answered: false });
  expect(capturePlan([use('a', { plan: '# One' }), result('a')].join('\n'))).toEqual({ plan: '# One', answered: true });
});

test('capturePlan falls back to the plan file and skips partial lines', () => {
  const jsonl = ['{"type":"assistant","message":{"content":[{"type":"tool_use","name":"ExitPlanMode"', use('a', { planFilePath: '/p/plan.md' })].join('\n');
  expect(capturePlan(jsonl, (p) => (p === '/p/plan.md' ? '# From file' : undefined))).toEqual({ plan: '# From file', answered: false });
  expect(capturePlan(use('a', { allowedPrompts: [] }))).toBeNull();
});

test('task store round-trips a project list and rejects a bad one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-'));
  try {
    const store = createTaskStore(dir);
    const tasks: TaskItem[] = [{ id: 't1', text: 'add a route', state: 'planned', planSession: 's1', plan: '# P', createdAt: 1 }];
    expect(await store.read('C:/Proj/A')).toEqual([]);
    expect(await store.write('C:/Proj/A', tasks)).toBe(true);
    expect(await store.read('C:/Proj/A')).toEqual(tasks);
    expect(await store.write('C:/Proj/A', [{ id: 'x', state: 'weird' }])).toBe(false);
    expect(isTaskList([])).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
