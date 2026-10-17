import { expect, test } from 'bun:test';
import { detectScreenError } from './screen-errors.ts';

test('detects auth, rate, overloaded and api errors', () => {
  expect(detectScreenError(['OAuth token has expired'])?.kind).toBe('auth');
  expect(detectScreenError(['Please run /login'])?.kind).toBe('auth');
  expect(detectScreenError(['API Error: 401 unauthorized'])?.kind).toBe('auth');
  expect(detectScreenError(['API Error: 429 rate limit'])?.kind).toBe('rate');
  expect(detectScreenError(['API Error: 529 {"type":"overloaded_error"}'])?.kind).toBe('overloaded');
  expect(detectScreenError(['API Error: 500 Internal server error'])?.kind).toBe('api');
});

test('ignores random numbers and clean screens', () => {
  expect(detectScreenError(['Read 500 lines', 'took 429ms', 'port 4010'])).toBeNull();
  expect(detectScreenError([])).toBeNull();
});

test('only the last 25 lines count', () => {
  const lines = ['Please run /login', ...Array.from({ length: 25 }, () => 'ok')];
  expect(detectScreenError(lines)).toBeNull();
  expect(detectScreenError(['ok', ...lines.slice(0, 1)])?.kind).toBe('auth');
});
