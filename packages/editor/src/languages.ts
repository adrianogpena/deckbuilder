import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import { json, jsonLanguage } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { MSSQL, MySQL, PLSQL, PostgreSQL, sql, SQLDialect, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { type Language, StreamLanguage } from '@codemirror/language';
import { c, cpp, csharp, java, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { css } from '@codemirror/legacy-modes/mode/css';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { javascript, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { python } from '@codemirror/legacy-modes/mode/python';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import type { Extension } from '@codemirror/state';
import { effectiveName, LOG_NAME } from '@deckbuilder/ui/file-associations';

export type Lang =
  | 'sql' | 'json' | 'shell' | 'java' | 'markdown' | 'xml' | 'text'
  | 'javascript' | 'typescript' | 'css' | 'html' | 'python' | 'yaml' | 'toml' | 'properties'
  | 'rust' | 'go' | 'c' | 'cpp' | 'csharp' | 'kotlin' | 'diff' | 'dockerfile';
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'plsql' | 'standard';
/** Table name → column names, for SQL completion. */
export type SqlSchema = Record<string, string[]>;

// Oracle's unquoted names are case-insensitive: without this, completing an upper-case table inserts it in "quotes".
const OracleSQL = SQLDialect.define({ ...PLSQL.spec, caseInsensitiveIdentifiers: true });

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, mssql: MSSQL, plsql: OracleSQL, standard: StandardSQL };

const STREAM_MODES = { shell, java, xml, html, javascript, typescript, css, python, yaml, toml, properties, rust, go, c, cpp, csharp, kotlin, diff, dockerfile: dockerFile };
type StreamLang = keyof typeof STREAM_MODES;
const streamLanguages = new Map<string, Language>();
/** The language of a legacy stream mode, defined once per mode. */
const streamLanguage = (lang: StreamLang): Language => {
  let language = streamLanguages.get(lang);
  if (!language) {
    language = StreamLanguage.define(STREAM_MODES[lang]);
    streamLanguages.set(lang, language);
  }
  return language;
};
const isStreamLang = (lang: Lang): lang is StreamLang => lang in STREAM_MODES;

export function languageFor(lang: Lang, opts: { sqlDialect?: SqlDialect; sqlSchema?: SqlSchema } = {}): Extension {
  switch (lang) {
    case 'sql': {
      const support = sql({ dialect: DIALECTS[opts.sqlDialect ?? 'standard'], schema: opts.sqlSchema });
      return opts.sqlSchema ? [support, support.language.data.of({ autocomplete: columnCompletion(opts.sqlSchema) })] : support;
    }
    case 'json': return json();
    case 'markdown': return markdown({ extensions: GFM });
    default: return isStreamLang(lang) ? streamLanguage(lang) : [];
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
    default: return isStreamLang(lang) ? streamLanguage(lang).parser : null;
  }
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

const LANG_BY_EXT: Record<string, Lang> = {
  sql: 'sql', pls: 'sql', pkb: 'sql', pks: 'sql', json: 'json', jsonc: 'json', java: 'java', sh: 'shell', bash: 'shell', curl: 'shell', http: 'shell',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', wsdl: 'xml', pom: 'xml', plist: 'xml', csproj: 'xml', fxml: 'xml',
  html: 'html', htm: 'html', xhtml: 'html',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  css: 'css', py: 'python', yaml: 'yaml', yml: 'yaml', toml: 'toml', properties: 'properties', ini: 'properties', cfg: 'properties', conf: 'properties',
  rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', kt: 'kotlin', kts: 'kotlin',
  diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
};

/** The editor language for a file name, by extension. */
export function langOfFile(name: string): Lang {
  return langOfEffective(effectiveName(name));
}

function langOfEffective(name: string): Lang {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'properties';
  return LANG_BY_EXT[extOf(name)] ?? 'text';
}

export type PreviewKind =
  | 'markdown' | 'json' | 'code' | 'image' | 'svg' | 'pdf' | 'archive' | 'log' | 'text'
  | 'audio' | 'video' | 'table' | 'font' | 'notebook' | 'har' | 'sqlite' | 'hex' | 'env';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']);
const ARCHIVE_EXTS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'lzma', 'zst', 'iso', 'cab', 'jar', 'war', 'whl', 'nupkg', 'apk',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub',
]);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi']);
const FONT_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const HEX_EXTS = new Set(['class', 'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'o', 'obj', 'dat', 'pyc']);
const SQLITE_EXTS = new Set(['sqlite', 'sqlite3', 'db', 'db3']);

/** How FilePreview shows a file: images need its bytes (`/api/fs/raw`), the rest its text. */
export function previewKind(original: string): PreviewKind {
  const name = effectiveName(original);
  if (LOG_NAME.test(name)) return 'log';
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.env')) return 'env';
  const ext = extOf(name);
  if (ext === 'csv' || ext === 'tsv') return 'table';
  if (ext === 'ipynb') return 'notebook';
  if (ext === 'har') return 'har';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (FONT_EXTS.has(ext)) return 'font';
  if (HEX_EXTS.has(ext)) return 'hex';
  if (SQLITE_EXTS.has(ext)) return 'sqlite';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  const lang = langOfEffective(name);
  if (lang === 'markdown' || lang === 'json') return lang;
  return lang === 'text' ? 'text' : 'code';
}
