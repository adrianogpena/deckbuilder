import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { DEFAULT_EDITOR_OPTIONS, editorOptionsExtension, indentUnitOf } from '../src/editorOptions.ts';
import { indentUnit } from '@codemirror/language';

describe('indentUnitOf', () => {
  test('spaces follow tabSize', () => expect(indentUnitOf({ ...DEFAULT_EDITOR_OPTIONS, tabSize: 2 })).toBe('  '));
  test('tabs when not inserting spaces', () => expect(indentUnitOf({ ...DEFAULT_EDITOR_OPTIONS, insertSpaces: false })).toBe('\t'));
});

describe('editorOptionsExtension', () => {
  test('applies tab size and indent unit', () => {
    const s = EditorState.create({ extensions: editorOptionsExtension({ tabSize: 2, insertSpaces: false }) });
    expect(s.tabSize).toBe(2);
    expect(s.facet(indentUnit)).toBe('\t');
  });
  test('absent options keep the editor defaults', () => {
    const s = EditorState.create({ extensions: editorOptionsExtension(undefined) });
    expect(s.tabSize).toBe(4);
    expect(s.facet(indentUnit)).toBe('  ');
  });
});
