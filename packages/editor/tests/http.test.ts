import { describe, expect, test } from 'bun:test';
import { bodyView, draftToSpec, emptyDraft, formatBytes, formatXml, toCurl, formatMs, statusTone, timeoutFromSeconds } from '../src/http.ts';

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
  test('bytes', () => {
    expect([0, 999, 1000, 1500, 123_456, 10_000_000].map(formatBytes)).toEqual(['0 B', '999 B', '1 kB', '1.5 kB', '123 kB', '10 MB']);
  });

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
