import { describe, expect, test } from 'bun:test';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { columnCompletion, langOfFile, languageFor, parserOf, previewKind } from '../src/languages.ts';

describe('langOfFile', () => {
  test('maps extensions case-insensitively', () => {
    expect(langOfFile('a.curl')).toBe('shell');
    expect(langOfFile('run.sh')).toBe('shell');
    expect(langOfFile('README.MD')).toBe('markdown');
    expect(langOfFile('q.sql')).toBe('sql');
    expect(langOfFile('data.json')).toBe('json');
  });

  test('falls back to text', () => {
    expect(langOfFile('x.bin')).toBe('text');
    expect(langOfFile('Makefile')).toBe('text');
  });
});

describe('previewKind', () => {
  test('sorts files into preview kinds', () => {
    expect(previewKind('notes.markdown')).toBe('markdown');
    expect(previewKind('a.json')).toBe('json');
    expect(previewKind('req.http')).toBe('code');
    expect(previewKind('logo.SVG')).toBe('svg');
    expect(previewKind('a.txt')).toBe('text');
  });

  test('sees log files, rotated ones included', () => {
    expect(previewKind('app.log')).toBe('log');
    expect(previewKind('server.log.1')).toBe('log');
    expect(previewKind('server.log.2026-10-08')).toBe('log');
    expect(previewKind('catalog.txt')).toBe('text');
    expect(previewKind('logo.png')).toBe('image');
    expect(previewKind('blog.md')).toBe('markdown');
  });
});

describe('parserOf', () => {
  test('gives parsers for highlighted languages only', () => {
    expect(parserOf('sql')).not.toBeNull();
    expect(parserOf('json')).not.toBeNull();
    expect(parserOf('shell')).not.toBeNull();
    expect(parserOf('text')).toBeNull();
  });
});

describe('columnCompletion', () => {
  const source = columnCompletion({ CUSTOMER: ['ID', 'NAME'], ORDERS: ['ORDER_ID'] });
  const labels = (doc: string, explicit = false) => {
    const result = source(new CompletionContext(EditorState.create({ doc }), doc.length, explicit)) as CompletionResult | null;
    return result?.options.map((o) => `${o.detail}.${o.label}`) ?? null;
  };

  test('offers the columns of tables named in the text', () => {
    expect(labels('select na from dual')).toBeNull();
    expect(labels('select * from customer where na')).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME']);
    expect(labels('select * from Customer c join orders o on o')).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME', 'ORDERS.ORDER_ID']);
  });

  test('stays out after a dot and without a typed word', () => {
    expect(labels('select * from customer c where c.')).toBeNull();
    expect(labels('select * from customer where ')).toBeNull();
    expect(labels('select * from customer where ', true)).toEqual(['CUSTOMER.ID', 'CUSTOMER.NAME']);
  });
});

test('plsql completes upper-case tables without quotes', async () => {
  const doc = 'select * from cust';
  const state = EditorState.create({ doc, extensions: [languageFor('sql', { sqlDialect: 'plsql', sqlSchema: { CUSTOMER: ['ID'] } })] });
  const options = [];
  for (const source of state.languageDataAt<(ctx: CompletionContext) => Promise<CompletionResult | null> | CompletionResult | null>('autocomplete', doc.length)) {
    options.push(...((await source(new CompletionContext(state, doc.length, false)))?.options ?? []));
  }
  const customer = options.find((o) => o.label === 'CUSTOMER');
  expect(customer).toBeDefined();
  expect(customer!.apply).toBeUndefined();
});
