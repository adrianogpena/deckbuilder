import { describe, expect, test } from 'bun:test';
import { parseSettingsQuery, settingDescriptionText, toggleModifiedFilter } from '../src/settings-schema';

describe('parseSettingsQuery', () => {
  test('plain text has no filters', () => {
    expect(parseSettingsQuery('  font  size ')).toEqual({ text: 'font size', modified: false, ids: [] });
  });

  test('@modified anywhere, any case', () => {
    expect(parseSettingsQuery('font @Modified size')).toEqual({ text: 'font size', modified: true, ids: [] });
  });

  test('several @id: tags, deduplicated, empty one ignored', () => {
    expect(parseSettingsQuery('@id:a.b @id: x @ID:c @id:a.b')).toEqual({ text: 'x', modified: false, ids: ['a.b', 'c'] });
  });

  test('filters combine', () => {
    expect(parseSettingsQuery('@modified @id:editor.tabSize')).toEqual({ text: '', modified: true, ids: ['editor.tabSize'] });
  });
});

describe('toggleModifiedFilter', () => {
  test('adds the tag in front', () => {
    expect(toggleModifiedFilter('')).toBe('@modified');
    expect(toggleModifiedFilter('font')).toBe('@modified font');
  });

  test('removes the tag', () => {
    expect(toggleModifiedFilter('font @MODIFIED size')).toBe('font size');
  });
});

describe('settingDescriptionText', () => {
  test('replaces links with labels, else the bare id', () => {
    const labelOf = (id: string) => (id === 'a.b' ? 'Tab Size' : undefined);
    expect(settingDescriptionText('See #a.b# and #c.d#.', labelOf)).toBe('See Tab Size and c.d.');
  });
});
