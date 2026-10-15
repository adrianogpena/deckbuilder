import type { Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { sqlMarkers } from './markers';

const markerMark = Decoration.mark({ class: 'cm-sql-marker' });
const fragmentMark = Decoration.mark({ class: 'cm-sql-fragment' });
const paramMark = Decoration.mark({ class: 'cm-sql-param' });
const PARAM = /\{\d+\}/g;

/** Decoration ranges (sorted by `from`) for markers, guarded fragments and `{n}` placeholders. */
export function sqlMarkerRanges(text: string): Array<{ from: number; to: number; kind: 'marker' | 'fragment' | 'param' }> {
  const out: Array<{ from: number; to: number; kind: 'marker' | 'fragment' | 'param' }> = [];
  for (const m of sqlMarkers(text)) {
    out.push({ from: m.from, to: m.to, kind: 'marker' });
    if (m.fragmentTo > m.fragmentFrom) out.push({ from: m.fragmentFrom, to: m.fragmentTo, kind: 'fragment' });
  }
  for (const p of text.matchAll(PARAM)) out.push({ from: p.index!, to: p.index! + p[0].length, kind: 'param' });
  const order = { marker: 0, fragment: 1, param: 2 };
  return out.sort((a, b) => a.from - b.from || order[a.kind] - order[b.kind]);
}

function build(view: EditorView): DecorationSet {
  const deco = { marker: markerMark, fragment: fragmentMark, param: paramMark };
  return Decoration.set(
    sqlMarkerRanges(view.state.doc.toString()).map((r) => deco[r.kind].range(r.from, r.to)),
    true,
  );
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.cm-sql-marker': { color: 'var(--info)', fontStyle: 'italic' },
  '.cm-sql-param': { color: 'var(--accent)', fontWeight: '600' },
  '.cm-sql-fragment': { backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' },
});

/** Styles `/*%JS=...%*\/` markers, their guarded fragment and `{n}` placeholders. */
export const sqlMarkerHighlight: Extension = [plugin, theme];
