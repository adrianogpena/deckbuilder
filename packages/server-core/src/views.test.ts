import { expect, test } from 'bun:test';
import { applyViewSettings, defineServerView, type FieldSpec, mountViews, validGroup } from './views.ts';

const ctx = { dataDir: '/d', settings: { load: async () => ({}) }, stores: {} };

test('validGroup accepts fitting values and rejects others', () => {
  const spec: Record<string, FieldSpec> = { a: 'boolean', b: [1, 5], c: ['x', 'y'] };
  expect(validGroup({ a: true, b: 3, c: 'x' }, spec)).toEqual({ a: true, b: 3, c: 'x' });
  expect(validGroup({ b: 9 }, spec)).toBeNull();
  expect(validGroup({ z: 1 }, spec)).toBeNull();
});

test('applyViewSettings only sets valid groups', () => {
  const v = defineServerView({
    id: 'a',
    routes: () => ({}),
    settings: { validate: { g: (raw) => validGroup(raw, { on: 'boolean' }) } },
  });
  const next: Record<string, unknown> = {};
  applyViewSettings([v], { g: { on: true }, other: 1 }, next);
  expect(next).toEqual({ g: { on: true } });
  const bad: Record<string, unknown> = {};
  applyViewSettings([v], { g: { on: 'no' } }, bad);
  expect(bad).toEqual({});
});

test('mountViews merges routes and throws on duplicates', async () => {
  let quit = 0;
  const a = defineServerView({ id: 'a', routes: () => ({ 'GET /a': () => 1 }), onQuit: () => void quit++ });
  const b = defineServerView({ id: 'b', routes: () => ({ 'GET /b': () => 2 }), onQuit: async () => void quit++ });
  const m = mountViews([a, b], ctx);
  expect(Object.keys(m.routes)).toEqual(['GET /a', 'GET /b']);
  await m.onQuit();
  expect(quit).toBe(2);
  const c = defineServerView({ id: 'c', routes: () => ({ 'GET /a': () => 3 }) });
  expect(() => mountViews([a, c], ctx)).toThrow('Duplicate route');
  expect(() => mountViews([a, a], ctx)).toThrow('already registered');
});

test('mountViews merges unauthenticated routes and throws on duplicates', () => {
  const a = defineServerView({ id: 'a', routes: () => ({}), unauthenticated: () => ({ 'GET /open/*': () => 1 }) });
  const b = defineServerView({ id: 'b', routes: () => ({}), unauthenticated: () => ({ 'GET /other': () => 2 }) });
  const c = defineServerView({ id: 'c', routes: () => ({}) });
  expect(Object.keys(mountViews([a, b, c], ctx).unauthenticated)).toEqual(['GET /open/*', 'GET /other']);
  const d = defineServerView({ id: 'd', routes: () => ({}), unauthenticated: () => ({ 'GET /other': () => 3 }) });
  expect(() => mountViews([b, d], ctx)).toThrow('Duplicate unauthenticated route');
});
