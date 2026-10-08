import { expect, test } from 'bun:test';
import { setLanguage, tryT } from '../src/i18n.ts';

test('an unknown saved language falls back to English', () => {
  setLanguage('fr');
  expect(tryT('common.close')).toBe('Close');
});

test('known languages and interpolation work', () => {
  setLanguage('pt-BR');
  expect(tryT('common.close')).toBe('Fechar');
  setLanguage('en');
  expect(tryT('error.http', { status: 500 })).toBe('HTTP error 500');
});

test('an unknown key is undefined', () => {
  expect(tryT('nope.nothing')).toBeUndefined();
});
