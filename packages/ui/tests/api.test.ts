import { expect, test } from 'bun:test';
import { errorMessage, errorOf, qs, RequestError } from '../src/api-core.ts';
import { setLanguage } from '../src/i18n.ts';

test('errorOf keeps a RequestError and wraps anything else as raw', () => {
  const info = { kind: 'invalid', code: 'invalidJson', message: 'Invalid JSON.' };
  expect(errorOf(new RequestError(info))).toBe(info);
  expect(errorOf(new Error('boom'))).toEqual({ kind: 'internal', code: 'raw', message: 'boom' });
  expect(errorOf('plain')).toEqual({ kind: 'internal', code: 'raw', message: 'plain' });
});

test('errorMessage translates known codes and falls back to the message', () => {
  setLanguage('pt-BR');
  expect(errorMessage({ kind: 'invalid', code: 'invalidJson', message: 'Invalid JSON.' })).toBe('JSON inválido.');
  expect(errorMessage({ kind: 'internal', code: 'http', params: { status: 502 }, message: 'x' })).toContain('502');
  expect(errorMessage({ kind: 'internal', code: 'raw', message: 'as sent' })).toBe('as sent');
  expect(errorMessage({ kind: 'invalid', code: 'noSuchCode', message: 'fallback' })).toBe('fallback');
  setLanguage('en');
});

test('qs skips empty values and writes true as 1', () => {
  expect(qs({})).toBe('');
  expect(qs({ a: undefined, b: '', c: false })).toBe('');
  expect(qs({ a: 'x y', n: 0, on: true, off: false })).toBe('?a=x+y&n=0&on=1');
});
