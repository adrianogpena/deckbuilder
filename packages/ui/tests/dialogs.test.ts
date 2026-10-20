import { expect, test } from 'bun:test';
import { dialogs, registerDialogHost, type DialogHostImpl } from '../src/dialogs.ts';

const impl = (calls: string[]): DialogHostImpl => ({
  confirm: async (o) => (calls.push(o.title), true),
  prompt: async () => 'x',
  choose: async () => 'a',
  open: () => () => {},
});

test('dialogs throw without a mounted host', () => {
  expect(() => dialogs.confirm({ title: 't' })).toThrow('DialogHost is not mounted');
});

test('dialogs delegate to the registered host and stop after unregister', async () => {
  const calls: string[] = [];
  const off = registerDialogHost(impl(calls));
  expect(await dialogs.confirm({ title: 'Sure?' })).toBe(true);
  expect(await dialogs.prompt({ title: 't', label: 'l' })).toBe('x');
  expect(calls).toEqual(['Sure?']);
  off();
  expect(() => dialogs.choose({ title: 't', choices: [] })).toThrow('DialogHost is not mounted');
});
