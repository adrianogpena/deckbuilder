import { closeBrackets } from '@codemirror/autocomplete';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightWhitespace, lineNumbers, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { createContext, useContext } from 'react';

/** Plain-data editor preferences; every field is optional and defaults to the built-in behavior. */
export interface EditorOptions {
  tabSize?: number;
  insertSpaces?: boolean;
  /** Initial wrapping for editors that don't set `wrap` themselves. */
  wordWrap?: boolean;
  lineNumbers?: boolean;
  highlightActiveLine?: boolean;
  renderWhitespace?: 'none' | 'selection' | 'all';
  bracketMatching?: boolean;
  autoCloseBrackets?: boolean;
  cursorStyle?: 'line' | 'block' | 'underline';
  cursorBlink?: boolean;
}

export const DEFAULT_EDITOR_OPTIONS: Required<EditorOptions> = {
  tabSize: 4, insertSpaces: true, wordWrap: false, lineNumbers: true, highlightActiveLine: true, renderWhitespace: 'none',
  bracketMatching: true, autoCloseBrackets: true, cursorStyle: 'line', cursorBlink: true,
};

/** The indent unit for the options: `tabSize` spaces, or a tab character. */
export const indentUnitOf = (o: Required<EditorOptions>): string => (o.insertSpaces ? ' '.repeat(o.tabSize) : '\t');

const cursorTheme = (style: 'block' | 'underline') => EditorView.theme({
  '.cm-cursor, .cm-dropCursor': style === 'block'
    ? { borderLeft: 'none', backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)', width: '0.6em' }
    : { borderLeft: 'none', borderBottom: '2px solid var(--accent)', width: '0.6em' },
});

const wsMark = Decoration.mark({ class: 'cm-ws-mark' });

function selectionWhitespace(view: EditorView): DecorationSet {
  const ranges = [];
  for (const r of view.state.selection.ranges) {
    if (r.empty) continue;
    const text = view.state.sliceDoc(r.from, r.to);
    for (let i = 0; i < text.length; i++) if (text[i] === ' ' || text[i] === '	') ranges.push(wsMark.range(r.from + i, r.from + i + 1));
  }
  return Decoration.set(ranges, true);
}

const selectionWhitespaceExt = [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = selectionWhitespace(view);
    }
    update(u: ViewUpdate) {
      if (u.selectionSet || u.docChanged) this.decorations = selectionWhitespace(u.view);
    }
  }, { decorations: (v) => v.decorations }),
  EditorView.baseTheme({ '.cm-ws-mark': { backgroundImage: 'radial-gradient(circle at 50% 55%, var(--text-3) 12%, transparent 14%)' } }),
];

/** Maps the options (defaults filled in) to CodeMirror extensions. */
export function editorOptionsExtension(options: EditorOptions | undefined): Extension {
  const o = { ...DEFAULT_EDITOR_OPTIONS, ...options };
  const indentSet = options?.tabSize !== undefined || options?.insertSpaces !== undefined;
  return [
    EditorState.tabSize.of(o.tabSize),
    indentSet ? indentUnit.of(indentUnitOf(o)) : [],
    o.lineNumbers ? lineNumbers() : [],
    o.highlightActiveLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    o.renderWhitespace === 'all' ? highlightWhitespace() : [],
    o.renderWhitespace === 'selection' ? selectionWhitespaceExt : [],
    o.bracketMatching ? bracketMatching() : [],
    o.autoCloseBrackets ? closeBrackets() : [],
    drawSelection({ cursorBlinkRate: o.cursorBlink ? 1200 : 0 }),
    o.cursorStyle === 'line' ? [] : cursorTheme(o.cursorStyle),
  ];
}

export const EditorOptionsContext = createContext<EditorOptions | undefined>(undefined);

/** The app-wide editor options, as provided above the editors. */
export const useEditorOptions = (): EditorOptions | undefined => useContext(EditorOptionsContext);
