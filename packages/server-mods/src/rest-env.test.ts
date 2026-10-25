import { expect, test } from 'bun:test';
import type { AppError } from '@kedalion/server-core';
import { unknownVariables, variableResolver } from './rest-env.ts';

test('resolve replaces known names and collects unknown ones', () => {
  const vars = variableResolver({ host: 'h.example', 'api.key': 'k' });
  expect(vars.resolve('https://{{host}}/x?k={{ api.key }}&u={{user}}&p={{pass}}&u2={{user}}')).toBe('https://h.example/x?k=k&u={{user}}&p={{pass}}&u2={{user}}');
  expect(vars.missing).toEqual(['user', 'pass']);
  try {
    vars.check();
    throw new Error('no throw');
  } catch (err) {
    expect((err as AppError).code).toBe('unknownVariable');
    expect((err as AppError).opts.params).toEqual({ names: 'user, pass' });
  }
});

test('check passes without unknown names and prototype keys are not variables', () => {
  const vars = variableResolver({ a: '1' });
  expect(vars.resolve('{{a}}')).toBe('1');
  vars.check();
  expect(vars.resolve('{{toString}}')).toBe('{{toString}}');
  expect(vars.missing).toEqual(['toString']);
});

test('built-ins: one time per resolver, fresh uuid and random int', () => {
  const now = new Date('2026-01-02T03:04:05.678Z');
  const vars = variableResolver({}, () => now);
  expect(vars.resolve('{{$timestamp}} {{$isoTimestamp}}')).toBe('1767323045 2026-01-02T03:04:05.678Z');
  const [a, b] = vars.resolve('{{$uuid}} {{$uuid}}').split(' ');
  expect(a).toMatch(/^[0-9a-f-]{36}$/);
  expect(a).not.toBe(b);
  const n = Number(vars.resolve('{{$randomInt}}'));
  expect(Number.isInteger(n) && n >= 0 && n <= 1000).toBe(true);
  expect(vars.resolve('{{$nope}}')).toBe('{{$nope}}');
  expect(vars.missing).toEqual(['$nope']);
});

test('variables shadow nothing outside their own keys', () => {
  expect(variableResolver({ $uuid: 'mine' }).resolve('{{$uuid}}')).toBe('mine');
  expect(unknownVariables(['a']).code).toBe('unknownVariable');
});
