import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import { json, jsonLanguage } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { MSSQL, MySQL, PLSQL, PostgreSQL, sql, SQLDialect, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { type Language, StreamLanguage } from '@codemirror/language';
import { java } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import type { Extension } from '@codemirror/state';

export type Lang = 'sql' | 'json' | 'shell' | 'java' | 'markdown' | 'xml' | 'text';
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'plsql' | 'standard';
/** Table name → column names, for SQL completion. */
export type SqlSchema = Record<string, string[]>;

// Oracle's unquoted names are case-insensitive: without this, completing an upper-case table inserts it in "quotes".
const OracleSQL = SQLDialect.define({ ...PLSQL.spec, caseInsensitiveIdentifiers: true });

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, mssql: MSSQL, plsql: OracleSQL, standard: StandardSQL };

const shellLanguage = StreamLanguage.define(shell);
const javaLanguage = StreamLanguage.define(java);
const xmlLanguage = StreamLanguage.define(xml);

export function languageFor(lang: Lang, opts: { sqlDialect?: SqlDialect; sqlSchema?: SqlSchema } = {}): Extension {
  switch (lang) {
    case 'sql': {
      const support = sql({ dialect: DIALECTS[opts.sqlDialect ?? 'standard'], schema: opts.sqlSchema });
      return opts.sqlSchema ? [support, support.language.data.of({ autocomplete: columnCompletion(opts.sqlSchema) })] : support;
    }
    case 'json': return json();
    case 'shell': return shellLanguage;
    case 'java': return javaLanguage;
    case 'xml': return xmlLanguage;
    case 'markdown': return markdown({ extensions: GFM });
    default: return [];
  }
}

const IDENT = /[A-Za-z_][\w$#]*/g;
/** Most text scanned for table names; a longer document gets no column completions. */
const MAX_SCAN = 200_000;

/**
 * Columns of the schema's tables named anywhere in the text, without a `table.` prefix (lang-sql
 * only completes columns after one). Table names match case-insensitively, as Oracle's unquoted ones do.
 */
export function columnCompletion(schema: SqlSchema): CompletionSource {
  const tables = new Map(Object.keys(schema).map((name) => [name.toUpperCase(), name]));
  return (ctx) => {
    const word = ctx.matchBefore(/[\w$#]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (ctx.state.sliceDoc(word.from - 1, word.from) === '.' || ctx.state.doc.length > MAX_SCAN) return null;
    const named = new Set<string>();
    for (const [ident] of ctx.state.doc.toString().matchAll(IDENT)) {
      const table = tables.get(ident.toUpperCase());
      if (table) named.add(table);
    }
    const options: Completion[] = [];
    for (const table of named) for (const label of schema[table]!) options.push({ label, type: 'property', detail: table, boost: -1 });
    return options.length ? { from: word.from, options, validFor: /^[\w$#]*$/ } : null;
  };
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

export type PreviewKind = 'markdown' | 'json' | 'code' | 'image' | 'svg' | 'pdf' | 'archive' | 'log' | 'text';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);
const ARCHIVE_EXTS = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'lzma', 'zst', 'iso', 'cab', 'jar', 'war', 'whl', 'nupkg', 'apk']);
// app.log, and rotated ones: server.log.1, server.log.2026-10-08.
const LOG_NAME = /\.log(\.[0-9][\w-]*)?$/i;

/** How FilePreview shows a file: images need its bytes (`/api/fs/raw`), the rest its text. */
export function previewKind(name: string): PreviewKind {
  if (LOG_NAME.test(name)) return 'log';
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  const lang = LANG_BY_EXT[ext];
  if (lang === 'markdown' || lang === 'json') return lang;
  return lang ? 'code' : 'text';
}
