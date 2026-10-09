import { json, jsonLanguage } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { MSSQL, MySQL, PostgreSQL, sql, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { type Language, StreamLanguage } from '@codemirror/language';
import { java } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Extension } from '@codemirror/state';

export type Lang = 'sql' | 'json' | 'shell' | 'java' | 'markdown' | 'text';
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'standard';
/** Table name → column names, for SQL completion. */
export type SqlSchema = Record<string, string[]>;

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, mssql: MSSQL, standard: StandardSQL };

const shellLanguage = StreamLanguage.define(shell);
const javaLanguage = StreamLanguage.define(java);

export function languageFor(lang: Lang, opts: { sqlDialect?: SqlDialect; sqlSchema?: SqlSchema } = {}): Extension {
  switch (lang) {
    case 'sql': return sql({ dialect: DIALECTS[opts.sqlDialect ?? 'standard'], schema: opts.sqlSchema });
    case 'json': return json();
    case 'shell': return shellLanguage;
    case 'java': return javaLanguage;
    case 'markdown': return markdown({ extensions: GFM });
    default: return [];
  }
}

export type Parser = Language['parser'];

/** The parser behind a language, for highlighting text outside an editor; null when there is none. */
export function parserOf(lang: Lang): Parser | null {
  switch (lang) {
    case 'sql': return StandardSQL.language.parser;
    case 'json': return jsonLanguage.parser;
    case 'shell': return shellLanguage.parser;
    case 'java': return javaLanguage.parser;
    default: return null;
  }
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

const LANG_BY_EXT: Record<string, Lang> = {
  sql: 'sql', json: 'json', java: 'java', sh: 'shell', bash: 'shell', curl: 'shell', http: 'shell', md: 'markdown', markdown: 'markdown',
};

/** The editor language for a file name, by extension. */
export function langOfFile(name: string): Lang {
  return LANG_BY_EXT[extOf(name)] ?? 'text';
}

export type PreviewKind = 'markdown' | 'json' | 'code' | 'image' | 'log' | 'text';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
// app.log, and rotated ones: server.log.1, server.log.2026-10-08.
const LOG_NAME = /\.log(\.[0-9][\w-]*)?$/i;

/** How FilePreview shows a file: images need its bytes (`/api/fs/raw`), the rest its text. */
export function previewKind(name: string): PreviewKind {
  if (LOG_NAME.test(name)) return 'log';
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  const lang = LANG_BY_EXT[ext];
  if (lang === 'markdown' || lang === 'json') return lang;
  return lang ? 'code' : 'text';
}
