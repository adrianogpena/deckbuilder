import { invalid } from '@kedalion/server-core';

/** The text encodings the file routes read and write; a file keeps its own on save. */
export type TextEncodingId = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252';

export const TEXT_ENCODINGS: readonly TextEncodingId[] = ['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252'];

const BOMS: Array<[TextEncodingId, number[]]> = [
  ['utf8bom', [0xef, 0xbb, 0xbf]],
  ['utf16le', [0xff, 0xfe]],
  ['utf16be', [0xfe, 0xff]],
];

const bomOf = (enc: TextEncodingId) => BOMS.find(([id]) => id === enc)?.[1] ?? [];

/** The encoding its byte order mark names, or undefined without one. */
export function encodingByBom(bytes: Uint8Array): TextEncodingId | undefined {
  return BOMS.find(([, bom]) => bom.every((b, i) => bytes[i] === b))?.[0];
}

/**
 * The encoding of a text file's first bytes: its BOM, else UTF-8 when the bytes are valid UTF-8,
 * else Windows-1252 (what Notepad calls ANSI on Western systems). The bytes of a `truncated` read
 * may end inside a character.
 */
export function detectEncoding(bytes: Uint8Array, truncated = false): TextEncodingId {
  const byBom = encodingByBom(bytes);
  if (byBom) return byBom;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated });
    return 'utf8';
  } catch {
    return 'windows1252';
  }
}

const LABELS: Record<TextEncodingId, string> = {
  utf8: 'utf-8',
  utf8bom: 'utf-8',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
  windows1252: 'windows-1252',
};

/** `bytes` as text in `enc`, without its BOM. */
export function decodeText(bytes: Uint8Array, enc: TextEncodingId): string {
  return new TextDecoder(LABELS[enc] as ConstructorParameters<typeof TextDecoder>[0]).decode(bytes.subarray(bomOf(enc).length));
}

let cp1252: Map<number, number> | undefined;

/** Code point → byte, built from the decoder so it round-trips exactly. */
function cp1252Bytes(): Map<number, number> {
  if (!cp1252) {
    const all = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
    cp1252 = new Map([...all].map((ch, i) => [ch.codePointAt(0)!, i]));
  }
  return cp1252;
}

/** `text` as bytes in `enc`, with the BOM the encoding has. A character Windows-1252 can't hold is refused, never replaced. */
export function encodeText(text: string, enc: TextEncodingId): Uint8Array {
  const bom = bomOf(enc);
  if (enc === 'utf8' || enc === 'utf8bom') {
    const body = new TextEncoder().encode(text);
    const out = new Uint8Array(bom.length + body.length);
    out.set(bom);
    out.set(body, bom.length);
    return out;
  }
  if (enc === 'windows1252') {
    const map = cp1252Bytes();
    const out = new Uint8Array(text.length);
    let n = 0;
    for (const ch of text) {
      const b = map.get(ch.codePointAt(0)!);
      if (b === undefined) throw invalid('unencodable', `"${ch}" can't be saved in Windows-1252. Remove it or change the encoding.`);
      out[n++] = b;
    }
    return out.subarray(0, n);
  }
  const out = new Uint8Array(bom.length + text.length * 2);
  out.set(bom);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(bom.length + i * 2, text.charCodeAt(i), enc === 'utf16le');
  return out;
}
