import { describe, expect, test } from 'bun:test';
import { Editor, ParserReady, parserCtx, SerializerReady, serializerCtx } from '@milkdown/core';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';

async function transformer(): Promise<(md: string) => string> {
  const g = globalThis as { document?: unknown };
  const had = 'document' in g;
  const saved = g.document;
  if (!had) g.document = { body: {} };
  let done!: (fn: (md: string) => string) => void;
  const ready = new Promise<(md: string) => string>((r) => (done = r));
  const capture: MilkdownPlugin = (ctx) => async () => {
    await ctx.wait(ParserReady);
    await ctx.wait(SerializerReady);
    const parse = ctx.get(parserCtx);
    const serialize = ctx.get(serializerCtx);
    done((md) => serialize(parse(md)));
  };
  const editor = Editor.make().use(commonmark).use(gfm);
  editor.use(capture);
  editor.create().catch(() => {});
  const fn = await ready;
  if (!had) delete g.document;
  else g.document = saved;
  return fn;
}

describe('rich tables round-trip', () => {
  test('alignment row and escaped pipes survive parse and serialize', async () => {
    const roundTrip = await transformer();
    const md = '| L | C | R | N |\n| :-- | :-: | --: | --- |\n| a \\| b | `x \\| y` | 3 | n |\n';
    const once = roundTrip(md);
    expect(once.split('\n')[1]).toMatch(/^\| :-+ \| :-+: \| -+: \| -+ \|$/);
    expect(once).toContain('a \\| b');
    expect(once).toContain('`x \\| y`');
    expect(roundTrip(once)).toBe(once);
  });
});
