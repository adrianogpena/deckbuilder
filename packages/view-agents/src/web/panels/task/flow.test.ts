import { expect, test } from 'bun:test';
import { advance, implementPrompt, type TaskItem } from './flow';

const task = (over: Partial<TaskItem>): TaskItem => ({ id: 't', text: 'x', state: 'planning', planSession: 's', createdAt: 1, ...over });

test('a plan nobody answered moves planning to planned; a revision replaces it', () => {
  expect(advance(task({}), { plan: { plan: null, answered: false } })).toBeNull();
  expect(advance(task({}), { plan: { plan: '# A', answered: false } })).toEqual({ state: 'planned', plan: '# A' });
  expect(advance(task({ state: 'planned', plan: '# A' }), { plan: { plan: '# A', answered: false } })).toBeNull();
  expect(advance(task({ state: 'planned', plan: '# A' }), { plan: { plan: '# B', answered: false } })).toEqual({ state: 'planned', plan: '# B' });
  expect(advance(task({}), { plan: { plan: '# A', answered: true } })).toBeNull();
});

test('implementing starts when the session works and is done when it stops after working', () => {
  expect(advance(task({ state: 'approved' }), {})).toBeNull();
  expect(advance(task({ state: 'approved' }), { implStatus: 'idle' })).toBeNull();
  expect(advance(task({ state: 'approved' }), { implStatus: 'starting' })).toEqual({ state: 'implementing', worked: true });
  expect(advance(task({ state: 'implementing', worked: true }), { implStatus: 'running' })).toBeNull();
  expect(advance(task({ state: 'implementing', worked: true }), { implStatus: 'needs-you' })).toEqual({ state: 'done' });
  expect(advance(task({ state: 'done' }), { implStatus: 'idle' })).toBeNull();
});

test('implementPrompt carries the plan', () => {
  expect(implementPrompt('# P')).toBe('Implement this plan:\n# P');
});
