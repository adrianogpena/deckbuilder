import { describe, expect, test } from 'bun:test';
import type { AppError } from '@deckbuilder/server-core';
import { parseOracleUrl, validConnection } from './oracle-url.ts';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as AppError).code;
  }
  return null;
};

describe('parseOracleUrl', () => {
  test.each([
    ['jdbc:oracle:thin:@host1:1521/SVC', 'host1:1521/SVC'],
    ['oracle:thin:@milesora4next4:1521/MILESNEXT', 'milesora4next4:1521/MILESNEXT'],
    ['JDBC:ORACLE:THIN:@db.example.com:1600/orcl.example.com', 'db.example.com:1600/orcl.example.com'],
    ['@//host1:1522/SVC', 'host1:1522/SVC'],
    ['oracle:thin:@//host1/SVC', 'host1:1521/SVC'],
    ['host1:1521/SVC', 'host1:1521/SVC'],
    ['  host1/SVC  ', 'host1:1521/SVC'],
    ['10.0.0.5:1521/SVC_1$#', '10.0.0.5:1521/SVC_1$#'],
    ['[::1]:1521/SVC', '[::1]:1521/SVC'],
    ['//[fe80::1]/SVC', '[fe80::1]:1521/SVC'],
  ])('%s', (raw, connectString) => {
    expect(parseOracleUrl(raw).connectString).toBe(connectString);
  });

  test('fields', () => {
    expect(parseOracleUrl('oracle:thin:@milesora4next4:1521/MILESNEXT')).toEqual({
      connectString: 'milesora4next4:1521/MILESNEXT',
      host: 'milesora4next4',
      port: 1521,
      service: 'MILESNEXT',
    });
    expect(parseOracleUrl('[::1]/S')).toMatchObject({ host: '::1', port: 1521 });
  });

  test('SID form', () => {
    expect(parseOracleUrl('jdbc:oracle:thin:@host1:1521:ORCL')).toEqual({
      connectString: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host1)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))',
      host: 'host1',
      port: 1521,
      sid: 'ORCL',
    });
    expect(parseOracleUrl('@[::1]:1521:ORCL').connectString).toContain('(HOST=::1)');
  });

  test.each([
    '',
    '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=s)))',
    'MYTNSALIAS',
    'host1:1521/SVC?connect_timeout=5',
    'host1:0/SVC',
    'host1:65536/SVC',
    'host1:port/SVC',
    'host 1:1521/SVC',
    'host1:1521/S VC',
    'oracle:thin:@host1/SVC',
    'host1:ORCL',
    '@//host1:1521:ORCL',
    '999.1.1.1:1521/SVC',
    '[nothex]:1521/SVC',
    'http://host1:1521/SVC',
    `host1:1521/${'S'.repeat(129)}`,
    `${'a'.repeat(300)}:1521/S`,
  ])('rejects %s', (raw) => {
    expect(codeOf(() => parseOracleUrl(raw))).toBe('badDbUrl');
  });

  test('rejects non-strings', () => {
    expect(codeOf(() => parseOracleUrl(42))).toBe('badDbUrl');
  });
});

describe('validConnection', () => {
  test('trims and keeps the fields', () => {
    expect(validConnection({ name: ' Dev ', url: ' oracle:thin:@h:1521/S ', user: ' scott ', password: 'x', extra: 1 }))
      .toEqual({ name: 'Dev', url: 'oracle:thin:@h:1521/S', user: 'scott' });
  });

  test('rejects', () => {
    expect(codeOf(() => validConnection(null))).toBe('badRequest');
    expect(codeOf(() => validConnection({ name: ' ', url: 'h/S', user: 'u' }))).toBe('dbBadName');
    expect(codeOf(() => validConnection({ name: 'x'.repeat(81), url: 'h/S', user: 'u' }))).toBe('dbBadName');
    expect(codeOf(() => validConnection({ name: 'n', url: 'nope', user: 'u' }))).toBe('badDbUrl');
    expect(codeOf(() => validConnection({ name: 'n', url: 'h/S', user: 'a b' }))).toBe('dbBadUser');
    expect(codeOf(() => validConnection({ name: 'n', url: 'h/S', user: 'u'.repeat(129) }))).toBe('dbBadUser');
  });
});
