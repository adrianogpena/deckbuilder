export const MAX_TEXT = 6000;
export const DEFAULT_SERVER = 'https://api.languagetool.org/v2';

export type IssueKind = 'spelling' | 'grammar' | 'semantic' | 'style';

export interface Issue {
  kind: IssueKind;
  /** Start of the wrong span in the checked text. */
  offset: number;
  /** The exact wrong span. */
  text: string;
  /** The best replacement, empty when there is none. */
  fix: string;
  /** Other replacements, best first. */
  alternatives: string[];
  /** Why it is wrong, in the language of the checked text. */
  reason: string;
}

export interface SpellResult {
  /** The LanguageTool code the text was checked in (the detected one for `auto`). */
  language: string;
  issues: Issue[];
}

export interface Language {
  code: string;
  label: string;
}

export const AUTO = 'auto';
export const MAX_LANGUAGES = 30;
const CODE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** English and Portuguese; the `languages` setting adds to these. */
export const BUILTIN_LANGUAGES: readonly Language[] = [
  { code: 'en-US', label: 'English' },
  { code: 'pt-BR', label: 'Português' },
];

export const isLanguageCode = (code: string): boolean => code === AUTO || CODE_RE.test(code);

/** The built-in languages plus the `code | label` lines of `text` (invalid and duplicate lines are skipped). */
export function parseLanguages(text: string): Language[] {
  const out = [...BUILTIN_LANGUAGES];
  for (const line of text.split(/\r?\n/)) {
    const [rawCode = '', ...rest] = line.split('|');
    const code = rawCode.trim();
    if (!CODE_RE.test(code) || out.some((l) => l.code === code)) continue;
    out.push({ code, label: rest.join('|').trim() || code });
    if (out.length >= MAX_LANGUAGES) break;
  }
  return out;
}

interface LtMatch {
  message?: unknown;
  offset?: unknown;
  length?: unknown;
  replacements?: unknown;
  rule?: { id?: unknown; category?: { id?: unknown } };
}

/** The LanguageTool category and rule id of a match, as one of our kinds. */
export function kindOf(categoryId: string, ruleId: string): IssueKind {
  if (categoryId === 'TYPOS' || /SPELL|MORFOLOGIK/.test(ruleId)) return 'spelling';
  if (categoryId === 'SEMANTICS' || categoryId === 'CONFUSED_WORDS' || categoryId === 'FALSE_FRIENDS' || categoryId === 'REDUNDANCY') return 'semantic';
  if (categoryId === 'STYLE' || categoryId === 'PLAIN_ENGLISH' || categoryId === 'WIKIPEDIA' || categoryId === 'TYPOGRAPHY' || categoryId === 'CASING') return 'style';
  return 'grammar';
}

/** Reads a LanguageTool `/check` answer; drops matches that do not fit inside `source`. */
export function parseCheck(body: unknown, source: string): SpellResult | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as { matches?: unknown; language?: { detectedLanguage?: { code?: unknown }; code?: unknown } };
  if (!Array.isArray(o.matches)) return undefined;
  const code = String(o.language?.detectedLanguage?.code ?? o.language?.code ?? '');
  const issues: Issue[] = [];
  for (const m of o.matches as LtMatch[]) {
    const offset = Number(m?.offset);
    const length = Number(m?.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || length <= 0 || offset < 0 || offset + length > source.length) continue;
    const alternatives = (Array.isArray(m.replacements) ? m.replacements : [])
      .map((r) => (r && typeof r === 'object' ? (r as { value?: unknown }).value : undefined))
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .slice(0, 5);
    issues.push({
      kind: kindOf(String(m.rule?.category?.id ?? ''), String(m.rule?.id ?? '')),
      offset,
      text: source.slice(offset, offset + length),
      fix: alternatives[0] ?? '',
      alternatives: alternatives.slice(1),
      reason: typeof m.message === 'string' ? m.message.slice(0, 300) : '',
    });
  }
  return { language: code, issues };
}

/** Replaces the span of `issue` with `fix` (default: its best fix), drops issues overlapping it and moves the offsets of the rest. */
export function applyIssue(text: string, issues: Issue[], issue: Issue, fix = issue.fix): { text: string; issues: Issue[] } {
  if (!fix) return { text, issues };
  const delta = fix.length - issue.text.length;
  const end = issue.offset + issue.text.length;
  const overlaps = (i: Issue) => i.offset < end && i.offset + i.text.length > issue.offset;
  return {
    text: text.slice(0, issue.offset) + fix + text.slice(end),
    issues: issues.filter((i) => i !== issue && !overlaps(i)).map((i) => (i.offset > issue.offset ? { ...i, offset: i.offset + delta } : i)),
  };
}

/** The text with the best fix of every issue applied. */
export function applyAll(text: string, issues: Issue[]): string {
  let out = text;
  let floor = Infinity;
  for (const i of [...issues].sort((a, b) => b.offset - a.offset)) {
    if (!i.fix || i.offset + i.text.length > floor) continue;
    out = out.slice(0, i.offset) + i.fix + out.slice(i.offset + i.text.length);
    floor = i.offset;
  }
  return out;
}

/** The `/check` endpoint of a LanguageTool server URL; undefined when it is not http(s). */
export function checkUrl(server: string): string | undefined {
  try {
    const u = new URL(server.trim() || DEFAULT_SERVER);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return `${u.href.replace(/\/+$/, '')}/check`;
  } catch {
    return undefined;
  }
}
