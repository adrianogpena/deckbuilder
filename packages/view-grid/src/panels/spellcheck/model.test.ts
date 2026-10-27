import { describe, expect, test } from 'bun:test';
import { applyAll, applyIssue, checkUrl, isLanguageCode, kindOf, parseCheck, parseLanguages } from './model';

const source = 'nos vai ao cinema, teh cat';
const body = {
  language: { code: 'pt-BR', detectedLanguage: { code: 'pt-BR' } },
  matches: [
    { message: 'Concordância', offset: 0, length: 7, replacements: [{ value: 'nós vamos' }, { value: 'nos vamos' }], rule: { id: 'X', category: { id: 'GRAMMAR' } } },
    { message: 'Typo', offset: 19, length: 3, replacements: [{ value: 'the' }], rule: { id: 'MORFOLOGIK_RULE_EN_US', category: { id: 'TYPOS' } } },
    { message: 'out of range', offset: 99, length: 3, replacements: [], rule: { id: 'Y', category: { id: 'GRAMMAR' } } },
  ],
};

describe('spellcheck model', () => {
  test('parseCheck maps matches and drops out-of-range ones', () => {
    const r = parseCheck(body, source)!;
    expect(r.language).toBe('pt-BR');
    expect(r.issues.map((i) => [i.kind, i.text, i.fix])).toEqual([['grammar', 'nos vai', 'nós vamos'], ['spelling', 'teh', 'the']]);
    expect(r.issues[0]!.alternatives).toEqual(['nos vamos']);
  });

  test('parseCheck rejects an unexpected body', () => {
    expect(parseCheck({}, 'a')).toBeUndefined();
  });

  test('applyIssue shifts later offsets', () => {
    const { issues } = parseCheck(body, source)!;
    const next = applyIssue(source, issues, issues[0]!);
    expect(next.text).toBe('nós vamos ao cinema, teh cat');
    expect(next.text.slice(next.issues[0]!.offset, next.issues[0]!.offset + 3)).toBe('teh');
  });

  test('applyAll applies every best fix', () => {
    expect(applyAll(source, parseCheck(body, source)!.issues)).toBe('nós vamos ao cinema, the cat');
  });

  test('parseLanguages adds valid lines to English and Portuguese', () => {
    const l = parseLanguages('de-DE | Deutsch\nfr\nbad code | x\nen-US | Dup\n');
    expect(l.map((x) => [x.code, x.label])).toEqual([['en-US', 'English'], ['pt-BR', 'Português'], ['de-DE', 'Deutsch'], ['fr', 'fr']]);
    expect(isLanguageCode('auto') && isLanguageCode('pt-BR') && !isLanguageCode('x; y')).toBe(true);
  });

  test('kindOf and checkUrl', () => {
    expect(kindOf('CONFUSED_WORDS', 'A')).toBe('semantic');
    expect(checkUrl('')).toBe('https://api.languagetool.org/v2/check');
    expect(checkUrl('http://localhost:8081/v2/')).toBe('http://localhost:8081/v2/check');
    expect(checkUrl('file:///x')).toBeUndefined();
  });
});
