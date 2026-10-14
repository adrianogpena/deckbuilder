import { describe, expect, test } from 'bun:test';
import { authHeaderValue, bodyView, draftToSpec, hasAuthHeader, parseAuthValue, queryParams, withQueryParams, emptyDraft, formatXml, toCurl, formatMs, statusTone, timeoutFromSeconds } from '../src/http.ts';
import { parseCurl } from '../src/http-import.ts';
import type { HttpRequestDraft } from '../src/http.ts';

const h = (name: string, value: string, enabled = true) => ({ name, value, enabled });

describe('draftToSpec', () => {
  test('drops disabled and unnamed headers and trims names', () => {
    const spec = draftToSpec({ ...emptyDraft(), url: 'http://x', headers: [h(' A ', '1'), h('B', '2', false), h('  ', '3')] });
    expect(spec.headers).toEqual([['A', '1']]);
  });

  test('omits the body for GET and HEAD', () => {
    expect(draftToSpec({ ...emptyDraft(), body: '{}' }).body).toBeUndefined();
    expect(draftToSpec({ ...emptyDraft(), method: 'HEAD', body: '{}' }).body).toBeUndefined();
  });

  test('omits an empty body', () => {
    expect(draftToSpec({ ...emptyDraft(), method: 'POST' }).body).toBeUndefined();
  });

  test('adds Content-Type for a JSON body once', () => {
    const spec = draftToSpec({ ...emptyDraft(), method: 'POST', body: '{}' });
    expect(spec.body).toBe('{}');
    expect(spec.headers).toEqual([['Content-Type', 'application/json']]);
  });

  test('keeps a Content-Type the user set, in any case', () => {
    const spec = draftToSpec({ ...emptyDraft(), method: 'POST', body: '{}', headers: [h('content-type', 'text/x')] });
    expect(spec.headers).toEqual([['content-type', 'text/x']]);
  });

  test('adds an XML Content-Type for an XML body', () => {
    const spec = draftToSpec({ ...emptyDraft(), method: 'POST', body: '<a/>', bodyLang: 'xml' });
    expect(spec.headers).toEqual([['Content-Type', 'application/xml']]);
  });

  test('toCurl builds a quoted multi-line command', () => {
    const spec = draftToSpec({ ...emptyDraft(), method: 'POST', url: 'http://x/a?b=1&c=2', body: `{"a":"it's"}`, headers: [h('X-A', 'v')], insecure: true });
    expect(toCurl(spec)).toBe(
      [`curl 'http://x/a?b=1&c=2'`, `-X POST`, `-L`, `--insecure`, `-H 'X-A: v'`, `-H 'Content-Type: application/json'`, `--data-raw '{"a":"it'\\''s"}'`].join(' \\\n  '),
    );
    expect(toCurl(draftToSpec({ ...emptyDraft(), url: 'http://x', followRedirects: false }))).toBe(`curl 'http://x'`);
  });

  test('formatXml indents nested elements and keeps text-only ones inline', () => {
    expect(formatXml('<?xml version="1.0"?><a><b>1</b><c x="1"/><d><e>  hi </e></d></a>')).toBe(
      ['<?xml version="1.0"?>', '<a>', '  <b>1</b>', '  <c x="1"/>', '  <d>', '    <e>hi</e>', '  </d>', '</a>'].join('\n'),
    );
  });

  test('formatXml rejects unbalanced tags', () => {
    expect(() => formatXml('<a><b></a>')).toThrow();
    expect(() => formatXml('<a>')).toThrow();
  });

  test('adds no Content-Type for a text body', () => {
    const spec = draftToSpec({ ...emptyDraft(), method: 'PUT', body: 'x', bodyLang: 'text' });
    expect(spec.headers).toEqual([]);
  });

  test('maps form and multipart bodies to form fields, skipping blank names', () => {
    const form = [{ name: ' a ', value: '1' }, { name: ' ', value: '2' }];
    const spec = draftToSpec({ ...emptyDraft(), method: 'POST', body: 'raw', bodyLang: 'form', form });
    expect(spec.bodyKind).toBe('form');
    expect(spec.form).toEqual([['a', '1']]);
    expect(spec.body).toBeUndefined();
    expect(draftToSpec({ ...emptyDraft(), method: 'POST', bodyLang: 'multipart', form }).bodyKind).toBe('multipart');
    expect(draftToSpec({ ...emptyDraft(), method: 'GET', bodyLang: 'form', form }).form).toBeUndefined();
  });

  test('passes options through only when set', () => {
    expect(Object.keys(draftToSpec(emptyDraft()))).toEqual(['method', 'url', 'headers']);
    const spec = draftToSpec({ ...emptyDraft(), timeoutMs: 5000, insecure: true, followRedirects: false });
    expect(spec).toMatchObject({ timeoutMs: 5000, insecure: true, followRedirects: false });
  });
});

describe('statusTone', () => {
  test('boundaries', () => {
    expect([199, 200, 299, 300, 399, 400, 404, 499, 500, 0].map(statusTone)).toEqual(
      ['err', 'ok', 'ok', 'info', 'info', 'warn', 'warn', 'warn', 'err', 'err'],
    );
  });
});

describe('formatting', () => {
  test('ms', () => {
    expect([12, 999, 1000, 1234, 12_345].map(formatMs)).toEqual(['12 ms', '999 ms', '1 s', '1.2 s', '12 s']);
  });
});

describe('bodyView', () => {
  test('JSON under a text/plain type is json', () => {
    const view = bodyView({ text: '{"a":1}', contentType: 'text/plain' });
    expect(view).toEqual({ kind: 'json', value: { a: 1 }, pretty: '{\n  "a": 1\n}' });
  });

  test('invalid JSON under a JSON type is text', () => {
    expect(bodyView({ text: '{oops', contentType: 'application/json' })).toEqual({ kind: 'text', lang: 'text', text: '{oops' });
  });

  test('markdown content type', () => {
    expect(bodyView({ text: '# hi', contentType: 'text/markdown; charset=utf-8' })).toMatchObject({ kind: 'text', lang: 'markdown' });
  });

  test('html is plain text', () => {
    expect(bodyView({ text: '<p>x</p>', contentType: 'text/html' })).toMatchObject({ kind: 'text', lang: 'text' });
  });

  test('binary', () => {
    expect(bodyView({ binary: true, contentType: 'image/png' })).toEqual({ kind: 'binary' });
  });
});

describe('timeoutFromSeconds', () => {
  test('rounds to whole seconds within the bounds', () => {
    expect(timeoutFromSeconds('1.0001')).toBe(1000);
    expect(timeoutFromSeconds('0')).toBe(1000);
    expect(timeoutFromSeconds('999')).toBe(300_000);
    expect(timeoutFromSeconds('')).toBeUndefined();
    expect(timeoutFromSeconds('abc')).toBeUndefined();
  });
});

describe('queryParams / withQueryParams', () => {
  test('parses raw pairs and keeps the rest of the URL', () => {
    expect(queryParams('api.local/x?a=1&b&&c={{v}}#top')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '' },
      { name: 'c', value: '{{v}}' },
    ]);
    expect(queryParams('http://x/y')).toEqual([]);
    expect(queryParams('http://x/y?')).toEqual([]);
  });

  test('rewrites only the query', () => {
    expect(withQueryParams('{{host}}/x?a=1#top', [{ name: 'a', value: '2' }, { name: 'b', value: '' }])).toBe('{{host}}/x?a=2&b#top');
    expect(withQueryParams('http://x/y?a=1#f', [])).toBe('http://x/y#f');
    expect(withQueryParams('http://x/y', [{ name: 'q', value: 'a b' }])).toBe('http://x/y?q=a b');
  });

  test('escapes separators and round-trips', () => {
    const rows = [{ name: 'a=b', value: 'x&y#z=1' }];
    const url = withQueryParams('http://x', rows);
    expect(url).toBe('http://x?a%3Db=x%26y%23z=1');
    expect(queryParams(url)).toEqual([{ name: 'a%3Db', value: 'x%26y%23z=1' }]);
  });

  test('drops rows with empty name and value', () => {
    expect(withQueryParams('http://x', [{ name: '', value: '' }, { name: '', value: '1' }])).toBe('http://x?=1');
  });
});

describe('auth values', () => {
  test('composes Basic and Bearer', () => {
    expect(authHeaderValue('basic', { user: 'ana', password: 'p:w', token: '' })).toBe(`Basic ${btoa('ana:p:w')}`);
    expect(authHeaderValue('bearer', { user: '', password: '', token: ' t0k ' })).toBe('Bearer t0k');
    expect(authHeaderValue('basic', { user: '', password: '', token: '' })).toBe('');
    expect(authHeaderValue('bearer', { user: '', password: '', token: '' })).toBe('');
  });

  test('parses back, including UTF-8 credentials', () => {
    const basic = authHeaderValue('basic', { user: 'joão', password: 'sé:1', token: '' });
    expect(parseAuthValue(basic)).toEqual({ kind: 'basic', user: 'joão', password: 'sé:1', token: '' });
    expect(parseAuthValue('Bearer abc')).toEqual({ kind: 'bearer', user: '', password: '', token: 'abc' });
    expect(parseAuthValue('Digest x').kind).toBeUndefined();
    expect(parseAuthValue('').kind).toBeUndefined();
  });

  test('hasAuthHeader ignores disabled headers', () => {
    expect(hasAuthHeader([h('authorization', 'x')])).toBe(true);
    expect(hasAuthHeader([h('Authorization', 'x', false)])).toBe(false);
  });
});

describe('toCurl form and auth', () => {
  test('writes form rows, multipart rows and auth', () => {
    const form = draftToSpec({ ...emptyDraft(), method: 'POST', url: 'http://x', bodyLang: 'form', form: [{ name: 'q', value: "a b'c" }] });
    expect(toCurl(form, `Basic ${btoa('u:p')}`).split(' \\\n  ')).toEqual([`curl 'http://x'`, '-X POST', '-L', `-u 'u:p'`, `--data-urlencode 'q=a b'\\''c'`]);
    const multi = draftToSpec({ ...emptyDraft(), method: 'POST', url: 'http://x', bodyLang: 'multipart', form: [{ name: 'a', value: '1' }, { name: 'f', value: '@x' }] });
    expect(toCurl(multi, 'Bearer t').split(' \\\n  ').slice(-3)).toEqual([`-H 'Authorization: Bearer t'`, `-F 'a=1'`, `--form-string 'f=@x'`]);
  });

  test('a hand-set Authorization header wins over auth', () => {
    const spec = draftToSpec({ ...emptyDraft(), url: 'http://x', headers: [{ name: 'Authorization', value: 'Bearer h', enabled: true }] });
    const curl = toCurl(spec, 'Bearer t');
    expect(curl).toContain('Bearer h');
    expect(curl).not.toContain('Bearer t');
  });

  test('round trip keeps form, multipart and auth', () => {
    const cases: Array<[HttpRequestDraft, string]> = [
      [{ ...emptyDraft(), method: 'POST', url: 'http://x', bodyLang: 'form', form: [{ name: 'q', value: 'a b&c=d' }, { name: 'e', value: '' }], authKind: 'basic' }, `Basic ${btoa('ana:p:w')}`],
      [{ ...emptyDraft(), method: 'PUT', url: 'http://x', bodyLang: 'multipart', form: [{ name: 'a', value: '1;type=x' }, { name: 'b', value: 'two words' }], authKind: 'bearer' }, 'Bearer t0k'],
    ];
    for (const [draft, auth] of cases) {
      const back = parseCurl(toCurl(draftToSpec(draft), auth));
      expect(back.auth).toBe(auth);
      expect(back.draft.method).toBe(draft.method);
      expect(back.draft.bodyLang).toBe(draft.bodyLang);
      expect(back.draft.form).toEqual(draft.form);
      expect(back.draft.authKind).toBe(draft.authKind);
      expect(back.warnings).toEqual([]);
    }
  });
});
