import { describe, expect, test } from 'bun:test';
import { RICH_COMMAND_IDS, runRichCommand, type RichApi, type RichFeature } from '../src/rich/commands.ts';
import { EXTERNAL_META, frontmatterYaml, isUserEdit, joinFrontmatter, richValue, splitFrontmatter } from '../src/rich/frontmatter.ts';

const tr = (docChanged: boolean, meta: Record<string, unknown> = {}) => ({ docChanged, getMeta: (k: string) => meta[k] });

describe('splitFrontmatter', () => {
  test('no frontmatter', () => {
    expect(splitFrontmatter('# Title\n')).toEqual({ front: '', body: '# Title\n' });
  });

  test('splits the block and joins the same bytes back', () => {
    const md = '---\r\ntitle: A\r\ntags: [x]  \r\n---\r\n\r\n# Body\n';
    const split = splitFrontmatter(md);
    expect(split.front).toBe('---\r\ntitle: A\r\ntags: [x]  \r\n---\r\n');
    expect(split.body).toBe('\r\n# Body\n');
    expect(joinFrontmatter(split)).toBe(md);
  });

  test('keeps a BOM and a dotted end fence', () => {
    const md = '﻿---\nk: v\n...\nText';
    const split = splitFrontmatter(md);
    expect(split.body).toBe('Text');
    expect(joinFrontmatter(split)).toBe(md);
    expect(frontmatterYaml(split.front)).toBe('k: v');
  });

  test('a rule later in the text is not frontmatter', () => {
    expect(splitFrontmatter('Text\n---\nmore\n---\n').front).toBe('');
    expect(frontmatterYaml('')).toBeNull();
  });
});

describe('round-trip guard', () => {
  test('only unmarked document changes are user edits', () => {
    expect(isUserEdit([])).toBe(false);
    expect(isUserEdit([tr(false)])).toBe(false);
    expect(isUserEdit([tr(true, { [EXTERNAL_META]: true })])).toBe(false);
    expect(isUserEdit([tr(true, { addToHistory: false })])).toBe(false);
    expect(isUserEdit([tr(false), tr(true)])).toBe(true);
  });

  test('an unchanged document gives the original text without serializing', () => {
    const original = '---\na: 1\n---\n*x*  \n';
    let calls = 0;
    expect(richValue(original, '---\na: 1\n---\n', true, () => {
      calls++;
      return '_x_\n';
    })).toBe(original);
    expect(calls).toBe(0);
  });

  test('an edit keeps the frontmatter bytes and serializes the body', () => {
    expect(richValue('old', '---\r\na: 1\r\n---\r\n', false, () => 'new\n')).toBe('---\r\na: 1\r\n---\r\nnew\n');
  });
});

describe('rich commands', () => {
  test('ids are unique', () => {
    expect(new Set(RICH_COMMAND_IDS).size).toBe(RICH_COMMAND_IDS.length);
  });

  test('the first handler that takes a command wins', () => {
    const seen: string[] = [];
    const features: RichFeature[] = [
      {},
      { handlers: { bold: () => (seen.push('a'), false) } },
      { handlers: { bold: () => (seen.push('b'), true) } },
      { handlers: { bold: () => (seen.push('c'), true) } },
    ];
    const api = {} as RichApi;
    expect(runRichCommand(features, 'bold', api)).toBe(true);
    expect(seen).toEqual(['a', 'b']);
    expect(runRichCommand(features, 'italic', api)).toBe(false);
  });
});
