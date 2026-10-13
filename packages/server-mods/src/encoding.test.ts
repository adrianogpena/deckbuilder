import { describe, expect, test } from 'bun:test';
import { decodeText, detectEncoding, encodeText, encodingByBom, type TextEncodingId } from './encoding.ts';

const bytes = (...n: number[]) => Uint8Array.from(n);

describe('encodingByBom', () => {
  test('names the encoding of each BOM', () => {
    expect(encodingByBom(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('utf8bom');
    expect(encodingByBom(bytes(0xff, 0xfe, 0x41, 0))).toBe('utf16le');
    expect(encodingByBom(bytes(0xfe, 0xff, 0, 0x41))).toBe('utf16be');
  });

  test('is undefined without a BOM', () => {
    expect(encodingByBom(bytes(0x41, 0x42))).toBeUndefined();
    expect(encodingByBom(bytes())).toBeUndefined();
  });
});

describe('detectEncoding', () => {
  test('prefers the BOM', () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('utf8bom');
    expect(detectEncoding(bytes(0xff, 0xfe, 0x41, 0))).toBe('utf16le');
  });

  test('valid UTF-8 is utf8, other bytes are windows1252', () => {
    expect(detectEncoding(new TextEncoder().encode('héllo'))).toBe('utf8');
    expect(detectEncoding(bytes(0x68, 0xe9, 0x6c))).toBe('windows1252');
  });

  test('a truncated read may end inside a character', () => {
    const cut = new TextEncoder().encode('é').subarray(0, 1);
    expect(detectEncoding(cut)).toBe('windows1252');
    expect(detectEncoding(cut, true)).toBe('utf8');
  });
});

describe('encodeText and decodeText', () => {
  test('write the BOM and decode without it', () => {
    expect([...encodeText('A', 'utf8bom')]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect([...encodeText('A', 'utf16le')]).toEqual([0xff, 0xfe, 0x41, 0]);
    expect([...encodeText('A', 'utf16be')]).toEqual([0xfe, 0xff, 0, 0x41]);
    expect([...encodeText('A', 'utf8')]).toEqual([0x41]);
  });

  test('round trip in every encoding', () => {
    const text = 'Olá, “mundo” €';
    for (const enc of ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252'] as TextEncodingId[]) {
      expect(decodeText(encodeText(text, enc), enc)).toBe(text);
    }
  });

  test('windows1252 uses one byte per character', () => {
    expect([...encodeText('é€', 'windows1252')]).toEqual([0xe9, 0x80]);
    expect(decodeText(bytes(0xe9, 0x80), 'windows1252')).toBe('é€');
  });

  test('windows1252 refuses a character it cannot hold', () => {
    expect(() => encodeText('日本', 'windows1252')).toThrow(/Windows-1252/);
    try {
      encodeText('日', 'windows1252');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('unencodable');
    }
  });
});
