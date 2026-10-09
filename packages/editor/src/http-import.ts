import { HTTP_METHODS, type HttpMethod, type HttpRequestDraft } from '@deckbuilder/server-core/protocol';
import { emptyDraft, timeoutFromSeconds } from './http';

/**
 * A request read from a cURL command or an `.http` file. `warnings` are `<code>:<argument>`
 * strings (`unknownFlag:--foo`, `dataFile:@body.json`, `unresolvedVar:host`, `bodyFile:x.json`,
 * `badHeader:…`, `badMethod:…`, `noUrl:`) for the UI to translate. `auth` is the Authorization
 * value taken out of the headers.
 */
export interface ImportedRequest {
  name?: string;
  draft: HttpRequestDraft;
  auth?: string;
  warnings: string[];
}

const METHODS = HTTP_METHODS as readonly string[];
const isJsonType = (type: string) => /json/i.test(type);

function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Builds the draft; the last Authorization header leaves the headers and becomes `auth`. */
function buildRequest(method: HttpMethod, url: string, pairs: Array<[string, string]>, body: string, warnings: string[]): ImportedRequest {
  let auth: string | undefined;
  let contentType = '';
  const headers = [];
  for (const [name, value] of pairs) {
    const lower = name.toLowerCase();
    if (lower === 'authorization') {
      auth = value;
      continue;
    }
    if (lower === 'content-type') contentType = value;
    headers.push({ name, value, enabled: true });
  }
  const draft: HttpRequestDraft = {
    ...emptyDraft(),
    method,
    url,
    headers,
    body,
    bodyLang: body === '' || isJsonType(contentType) || parsesAsJson(body) ? 'json' : 'text',
  };
  return { draft, ...(auth !== undefined ? { auth } : {}), warnings };
}

// --- cURL ---

const ANSI_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/** Reads a `$'…'` string whose opening quote is at `start`; returns the text and the index of the closing quote. */
function readAnsiC(text: string, start: number): { value: string; end: number } {
  let value = '';
  let i = start + 1;
  for (; i < text.length && text[i] !== "'"; i++) {
    if (text[i] !== '\\') {
      value += text[i];
      continue;
    }
    const next = text[i + 1] ?? '';
    const hex = /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8}))/.exec(text.slice(i + 1, i + 10));
    const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4));
    if (next in ANSI_ESCAPES) {
      value += ANSI_ESCAPES[next];
      i += 1;
    } else if (hex) {
      value += String.fromCodePoint(parseInt(hex[1] ?? hex[2] ?? hex[3], 16));
      i += hex[0].length;
    } else if (octal) {
      value += String.fromCharCode(parseInt(octal[0], 8));
      i += octal[0].length;
    } else {
      value += `\\${next}`;
      i += 1;
    }
  }
  return { value, end: i };
}

function tokenizeBash(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  const flush = () => {
    if (has) tokens.push(cur);
    cur = '';
    has = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      flush();
    } else if (c === '\\') {
      if (text[i + 1] === '\n') {
        i += 1;
      } else if (i + 1 < text.length) {
        cur += text[i + 1];
        has = true;
        i += 1;
      }
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end;
      cur += text.slice(i + 1, stop);
      has = true;
      i = stop;
    } else if (c === '$' && text[i + 1] === "'") {
      const { value, end } = readAnsiC(text, i + 1);
      cur += value;
      has = true;
      i = end;
    } else if (c === '"') {
      has = true;
      i += 1;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
          if (text[i + 1] !== '\n') cur += text[i + 1];
          i += 1;
        } else {
          cur += text[i];
        }
      }
    } else {
      cur += c;
      has = true;
    }
  }
  flush();
  return tokens;
}

/** cmd.exe: `^` escapes the next character; `^` before a line break continues the command (two breaks = a newline in the text). */
function unescapeCmd(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '^') {
      out += text[i];
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === '\n') {
      if (text[i + 2] === '\n') {
        out += '\n';
        i += 2;
      } else {
        i += 1;
      }
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

function tokenizeCmd(text: string): string[] {
  const src = unescapeCmd(text);
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '\\' && src[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"' && src[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

/** Flags that take a value, by long name → the short letter they share. */
const LONG_VALUE: Record<string, string> = {
  request: 'X',
  header: 'H',
  data: 'd',
  'data-raw': 'd',
  'data-binary': 'd',
  'data-ascii': 'd',
  'data-urlencode': 'urlencode',
  json: 'json',
  user: 'u',
  cookie: 'b',
  'user-agent': 'A',
  referer: 'e',
  'max-time': 'm',
  url: 'url',
};
const LONG_BOOL: Record<string, string> = { get: 'G', insecure: 'k', location: 'L', head: 'I' };
const IGNORED_LONG = new Set(['compressed', 'silent', 'show-error', 'verbose', 'include', 'fail', 'globoff', 'http1.1', 'http2', 'no-progress-meter']);
const VALUE_SHORT = 'XHdubAem';
const BOOL_SHORT = 'GkLI';
const IGNORED_SHORT = 'sSvifg';

/** Percent-encodes like curl's --data-urlencode (everything but the RFC 3986 unreserved characters). */
const urlencode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function urlencodedData(value: string, warnings: string[]): string {
  const at = value.indexOf('@');
  const eq = value.indexOf('=');
  if (eq < 0 && at >= 0) {
    warnings.push(`dataFile:${value.slice(at)}`);
    return value;
  }
  if (eq < 0) return urlencode(value);
  const name = value.slice(0, eq);
  return name ? `${name}=${urlencode(value.slice(eq + 1))}` : urlencode(value.slice(eq + 1));
}

/** Reads a cURL command as the browser devtools copy it, in its bash or cmd form. Throws `Error('notCurl')` for other text. */
export function parseCurl(text: string): ImportedRequest {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const cmd = /\^\n/.test(src) || /\^"/.test(src);
  const tokens = cmd ? tokenizeCmd(src) : tokenizeBash(src);
  if (tokens[0] === '$') tokens.shift();
  const first = tokens.shift();
  if (!first || !/^curl(\.exe)?$/i.test(first)) throw new Error('notCurl');

  const warnings: string[] = [];
  const headers: Array<[string, string]> = [];
  const data: string[] = [];
  let url: string | undefined;
  let method: string | undefined;
  let asGet = false;
  let head = false;
  let insecure: boolean | undefined;
  let followRedirects: boolean | undefined;
  let timeoutMs: number | undefined;

  const addHeader = (line: string) => {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    else if (colon < 0 && line.endsWith(';') && line.length > 1) headers.push([line.slice(0, -1).trim(), '']);
    else if (colon < 0) warnings.push(`badHeader:${line}`);
  };
  const addData = (value: string) => {
    if (value.startsWith('@')) warnings.push(`dataFile:${value}`);
    data.push(value);
  };
  const withValue = (key: string, value: string) => {
    switch (key) {
      case 'X':
        method = value.toUpperCase();
        break;
      case 'H':
        addHeader(value);
        break;
      case 'd':
        addData(value);
        break;
      case 'urlencode':
        data.push(urlencodedData(value, warnings));
        break;
      case 'json':
        addData(value);
        if (!headers.some(([n]) => n.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);
        if (!headers.some(([n]) => n.toLowerCase() === 'accept')) headers.push(['Accept', 'application/json']);
        break;
      case 'u':
        headers.push(['Authorization', `Basic ${base64Utf8(value)}`]);
        break;
      case 'b':
        if (value.includes('=')) headers.push(['Cookie', value]);
        else warnings.push(`cookieFile:${value}`);
        break;
      case 'A':
        headers.push(['User-Agent', value]);
        break;
      case 'e':
        headers.push(['Referer', value]);
        break;
      case 'm':
        timeoutMs = timeoutFromSeconds(value);
        break;
      case 'url':
        url ??= value;
        break;
    }
  };
  const flag = (key: string) => {
    if (key === 'G') asGet = true;
    else if (key === 'k') insecure = true;
    else if (key === 'L') followRedirects = true;
    else if (key === 'I') head = true;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('--') && token.length > 2) {
      const eq = token.indexOf('=');
      const name = eq > 0 ? token.slice(2, eq) : token.slice(2);
      if (name in LONG_VALUE) {
        const value = eq > 0 ? token.slice(eq + 1) : tokens[++i];
        if (value === undefined) warnings.push(`missingValue:--${name}`);
        else withValue(LONG_VALUE[name], value);
      } else if (name in LONG_BOOL) {
        flag(LONG_BOOL[name]);
      } else if (!IGNORED_LONG.has(name)) {
        warnings.push(`unknownFlag:--${name}`);
      }
    } else if (token.startsWith('-') && token.length > 1) {
      for (let j = 1; j < token.length; j++) {
        const ch = token[j];
        if (VALUE_SHORT.includes(ch)) {
          const value = token.slice(j + 1) || tokens[++i];
          if (value === undefined) warnings.push(`missingValue:-${ch}`);
          else withValue(ch, value);
          break;
        }
        if (BOOL_SHORT.includes(ch)) flag(ch);
        else if (!IGNORED_SHORT.includes(ch)) warnings.push(`unknownFlag:-${ch}`);
      }
    } else if (url === undefined) {
      url = token;
    } else {
      warnings.push(`extraArgument:${token}`);
    }
  }

  let target = url ?? '';
  if (!target) warnings.push('noUrl:');
  let body = data.join('&');
  if (asGet && body) {
    target += `${target.includes('?') ? '&' : '?'}${body}`;
    body = '';
  }
  let verb: HttpMethod = body ? 'POST' : head ? 'HEAD' : 'GET';
  if (method !== undefined) {
    if (METHODS.includes(method)) verb = method as HttpMethod;
    else warnings.push(`badMethod:${method}`);
  }
  const result = buildRequest(verb, target, headers, body, warnings);
  if (timeoutMs !== undefined) result.draft.timeoutMs = timeoutMs;
  if (insecure !== undefined) result.draft.insecure = insecure;
  if (followRedirects !== undefined) result.draft.followRedirects = followRedirects;
  return result;
}

// --- .http files ---

interface RawRequest {
  name?: string;
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body: string;
  warnings: string[];
}

const isComment = (trimmed: string) => trimmed.startsWith('#') || trimmed.startsWith('//');
const VARIABLE = /^@([\w.-]+)\s*=\s*(.*)$/;
const MAX_VAR_DEPTH = 5;

/**
 * Reads a VS Code REST Client / IntelliJ `.http` file: requests separated by `###` (the text after
 * it names the next request, as does `# @name x`), file variables `@var = value` used as `{{var}}`,
 * a request line `[METHOD] URL [HTTP/1.1]` with `?`/`&` continuation lines, headers up to a blank
 * line, then the body. `#` and `//` lines are comments everywhere.
 */
export function parseHttpFile(text: string): ImportedRequest[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Array<{ title: string; lines: string[] }> = [{ title: '', lines: [] }];
  for (const line of lines) {
    const separator = /^#{3,}(.*)$/.exec(line);
    if (separator) blocks.push({ title: separator[1].trim(), lines: [] });
    else blocks[blocks.length - 1].lines.push(line);
  }

  const variables = new Map<string, string>();
  const raws: RawRequest[] = [];
  for (const block of blocks) {
    let name: string | undefined;
    let request: RawRequest | undefined;
    let phase: 'start' | 'headers' | 'body' = 'start';
    const body: string[] = [];
    for (const line of block.lines) {
      const trimmed = line.trim();
      if (isComment(trimmed)) {
        const named = /^(?:#|\/\/)\s*@name\s+(.+)$/.exec(trimmed);
        if (named) name = named[1].trim();
        continue;
      }
      if (phase === 'body') {
        body.push(line);
      } else if (phase === 'start') {
        if (trimmed === '') continue;
        const variable = VARIABLE.exec(trimmed);
        if (variable) {
          variables.set(variable[1], variable[2].trim());
          continue;
        }
        const parts = /^([A-Za-z]+)\s+(.+)$/.exec(trimmed);
        const warnings: string[] = [];
        let method: HttpMethod = 'GET';
        let rest = trimmed;
        if (parts && METHODS.includes(parts[1].toUpperCase())) {
          method = parts[1].toUpperCase() as HttpMethod;
          rest = parts[2];
        } else if (parts && /^[A-Z]+$/.test(parts[1])) {
          warnings.push(`badMethod:${parts[1]}`);
          rest = parts[2];
        }
        request = { method, url: rest.replace(/\s+HTTP\/\d(?:\.\d)?$/i, '').trim(), headers: [], body: '', warnings };
        phase = 'headers';
      } else if (trimmed === '') {
        phase = 'body';
      } else if (request && request.headers.length === 0 && (trimmed.startsWith('?') || trimmed.startsWith('&'))) {
        request.url += trimmed;
      } else if (request) {
        const colon = trimmed.indexOf(':');
        if (colon > 0) request.headers.push([trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim()]);
        else request.warnings.push(`badHeader:${trimmed}`);
      }
    }
    if (!request) continue;
    while (body.length && body[0].trim() === '') body.shift();
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const file = body.length === 1 ? /^<@?\s+(.+)$/.exec(body[0].trim()) : null;
    if (file) request.warnings.push(`bodyFile:${file[1].trim()}`);
    request.body = file ? '' : body.join('\n');
    request.name = name ?? (block.title || undefined);
    raws.push(request);
  }

  const substitute = (value: string, missing: Set<string>, depth = 0): string =>
    value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, key: string) => {
      const known = variables.get(key);
      if (known !== undefined && depth < MAX_VAR_DEPTH) return substitute(known, missing, depth + 1);
      missing.add(key);
      return all;
    });

  return raws.map((raw) => {
    const missing = new Set<string>();
    const sub = (value: string) => substitute(value, missing);
    const result = buildRequest(
      raw.method,
      sub(raw.url),
      raw.headers.map(([n, v]) => [sub(n), sub(v)]),
      sub(raw.body),
      raw.warnings,
    );
    if (raw.name !== undefined) result.name = sub(raw.name);
    if (result.auth !== undefined) result.auth = sub(result.auth);
    for (const key of missing) result.warnings.push(`unresolvedVar:${key}`);
    return result;
  });
}

const CURL_START = /^(?:\$\s+)?curl(?:\.exe)?(?:\s|$)/i;

/** Pasted text → requests: a cURL command gives one, anything else is read as `.http` content. */
export function parseImport(text: string): ImportedRequest[] {
  return CURL_START.test(text.trim()) ? [parseCurl(text)] : parseHttpFile(text);
}
