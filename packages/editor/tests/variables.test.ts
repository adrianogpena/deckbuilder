import { describe, expect, test } from 'bun:test';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { RestEnvVar } from '@deckbuilderkit/server-core/protocol';
import { filterVariableOptions, insertVariable, variableAutocomplete, variableCompletion, variableCompletionText, variableOptions, variableQueryAt } from '../src/variables.ts';

const vars: RestEnvVar[] = [
  { name: 'host', value: 'example.com', secret: false, enabled: true },
  { name: 'token', value: '', secret: true, enabled: true, set: true },
  { name: 'unset', value: '', secret: true, enabled: true },
  { name: 'off', value: 'x', secret: false, enabled: false },
];

describe('variableOptions', () => {
  test('lists enabled, set variables and the built-ins', () => {
    const names = variableOptions(vars).map((o) => o.name);
    expect(names).toEqual(['host', 'token', '$timestamp', '$isoTimestamp', '$uuid', '$randomInt']);
    expect(variableOptions(vars)[0]!.detail).toBe('example.com');
    expect(variableOptions(vars)[1]!.detail).not.toBe('');
  });

  test('filters by substring, prefix matches first', () => {
    const opts = [{ name: 'xhost', detail: '' }, { name: 'host', detail: '' }, { name: 'port', detail: '' }];
    expect(filterVariableOptions(opts, 'HO').map((o) => o.name)).toEqual(['host', 'xhost']);
  });
});

describe('variableQueryAt / insertVariable', () => {
  test('finds an open reference before the caret', () => {
    expect(variableQueryAt('a {{ho', 6)).toEqual({ from: 2, partial: 'ho' });
    expect(variableQueryAt('{{$u', 4)).toEqual({ from: 0, partial: '$u' });
    expect(variableQueryAt('{{host}} x', 10)).toBeNull();
    expect(variableQueryAt('{ho', 3)).toBeNull();
  });

  test('replaces the partial and an existing closing brace pair', () => {
    expect(insertVariable('https://{{ho/x', 12, 'host')).toEqual({ text: 'https://{{host}}/x', caret: 16 });
    expect(insertVariable('{{ho}} y', 4, 'host')).toEqual({ text: '{{host}} y', caret: 8 });
    expect(insertVariable('{{h', 3, '$uuid')).toEqual({ text: '{{$uuid}}', caret: 9 });
  });

  test('completion text skips an existing }}', () => {
    expect(variableCompletionText('host', '}} rest')).toBe('host');
    expect(variableCompletionText('host', '"')).toBe('host}}');
  });
});

describe('variableCompletion', () => {
  const run = (doc: string) => variableCompletion(vars)(new CompletionContext(EditorState.create({ doc }), doc.length, false)) as CompletionResult | null;

  test('completes after {{', () => {
    const r = run('{"a": "{{ho');
    expect(r?.from).toBe(9);
    expect(r?.options.map((o) => o.label)).toContain('host');
    expect(run('{"a": "{{')?.from).toBe(9);
  });

  test('stays quiet elsewhere', () => {
    expect(run('{"a": "ho')).toBeNull();
  });

  test('is registered as language data', () => {
    const state = EditorState.create({ doc: '{{', extensions: variableAutocomplete(vars) });
    expect(state.languageDataAt('autocomplete', 2).length).toBe(1);
  });
});
