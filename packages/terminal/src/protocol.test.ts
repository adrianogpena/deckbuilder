import { describe, expect, test } from 'bun:test';
import { decodeClientMessage, decodeServerMessage, encodeControl, MAX_TITLE, type ServerControl } from './protocol.ts';

describe('decodeClientMessage', () => {
  test('binary frames are input', () => {
    const bytes = new Uint8Array([104, 105]);
    expect(decodeClientMessage(bytes)).toEqual({ kind: 'input', data: bytes });
    const fromBuffer = decodeClientMessage(bytes.buffer);
    expect(fromBuffer).toEqual({ kind: 'input', data: bytes });
  });

  test('valid resize and close decode', () => {
    expect(decodeClientMessage('{"type":"resize","cols":120,"rows":30}')).toEqual({
      kind: 'control',
      msg: { type: 'resize', cols: 120, rows: 30 },
    });
    expect(decodeClientMessage('{"type":"close"}')).toEqual({ kind: 'control', msg: { type: 'close' } });
  });

  test.each([
    '{"type":"resize","cols":0,"rows":30}',
    '{"type":"resize","cols":1001,"rows":30}',
    '{"type":"resize","cols":80,"rows":1001}',
    '{"type":"resize","cols":1.5,"rows":30}',
    '{"type":"resize","cols":"80","rows":"30"}',
    '{"type":"resize","cols":80}',
    '{"type":"exit","code":0}',
    '{"type":"nope"}',
    '[1]',
    'null',
    'not json',
    '',
  ])('rejects %s', (text) => {
    expect(decodeClientMessage(text)).toBeNull();
  });

  test('rejects oversized text', () => {
    const big = JSON.stringify({ type: 'close', pad: 'x'.repeat(70 * 1024) });
    expect(decodeClientMessage(big)).toBeNull();
  });
});

describe('decodeServerMessage', () => {
  test('hello, exit and title round-trip', () => {
    const msgs: ServerControl[] = [
      { type: 'hello', session: 'abc', cols: 80, rows: 24 },
      { type: 'exit', code: 3 },
      { type: 'exit', code: null },
      { type: 'title', title: 'hi' },
    ];
    for (const msg of msgs) expect(decodeServerMessage(encodeControl(msg))).toEqual({ kind: 'control', msg });
  });

  test('binary frames are output', () => {
    const bytes = new Uint8Array([1, 2]);
    expect(decodeServerMessage(bytes)).toEqual({ kind: 'output', data: bytes });
  });

  test('title is capped', () => {
    const decoded = decodeServerMessage(encodeControl({ type: 'title', title: 'x'.repeat(1000) }));
    expect(decoded).toEqual({ kind: 'control', msg: { type: 'title', title: 'x'.repeat(MAX_TITLE) } });
  });

  test.each([
    '{"type":"hello","session":"a","cols":0,"rows":24}',
    '{"type":"hello","cols":80,"rows":24}',
    '{"type":"exit","code":"1"}',
    '{"type":"exit"}',
    '{"type":"title","title":5}',
    '{"type":"resize","cols":80,"rows":24}',
    'not json',
  ])('rejects %s', (text) => {
    expect(decodeServerMessage(text)).toBeNull();
  });
});
