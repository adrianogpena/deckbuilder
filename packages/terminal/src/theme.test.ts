import { expect, test } from 'bun:test';
import { xtermTheme } from './theme.ts';

test('maps tokens to theme slots', () => {
  const tokens: Record<string, string> = {
    '--bg-sunken': ' #101010 ',
    '--text': '#eeeeee',
    '--accent': '#3388ff',
    '--err': '#ff0000',
    '--y-str': '#00cccc',
  };
  const theme = xtermTheme((t) => tokens[t] ?? '');
  expect(theme.background).toBe('#101010');
  expect(theme.foreground).toBe('#eeeeee');
  expect(theme.cursor).toBe('#3388ff');
  expect(theme.red).toBe('#ff0000');
  expect(theme.brightRed).toBe('#ff0000');
  expect(theme.cyan).toBe('#00cccc');
  expect(theme.brightWhite).toBe('#eeeeee');
});

test('leaves missing tokens undefined', () => {
  const theme = xtermTheme((t) => (t === '--text' ? '#fff' : ''));
  expect(theme.foreground).toBe('#fff');
  expect(theme.background).toBeUndefined();
  expect(theme.green).toBeUndefined();
  expect('blue' in theme).toBe(false);
});
