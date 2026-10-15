import { autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { type EditorOptions, editorOptionsExtension, useEditorOptions } from './editorOptions';
import { type Lang, languageFor, type SqlDialect, type SqlSchema } from './languages';
import { formatSql, type SqlFormatOptions } from './sql/format';
import { statementAt } from './sql/statements';
import { themeExtension } from './theme';

export interface CodeEditorProps {
  value: string;
  lang: Lang;
  onChange?(value: string): void;
  /** Mod-Enter runs the statement under the cursor (or the selection); Mod-Shift-Enter runs everything. */
  onRun?(value: string, mode: RunMode): void;
  readOnly?: boolean;
  placeholder?: string;
  sqlDialect?: SqlDialect;
  /** Table → columns, for SQL completion. */
  sqlSchema?: SqlSchema;
  /** CSS length; a number is px. Without it the editor grows with its content. */
  height?: number | string;
  autoFocus?: boolean;
  /** Scroll position as a fraction (0..1) of the scroll range. */
  onScroll?(fraction: number): void;
  /** Extra extensions, swapped in place when the value changes. */
  extensions?: Extension;
  /** Wrap long lines; default off. */
  wrap?: boolean;
  /** The cursor and selection, on load and whenever they change. */
  onSelection?(info: SelectionInfo): void;
  /** Editor preferences; without it the app-wide ones (EditorOptionsContext), else the built-in defaults. */
  options?: EditorOptions;
}

export type RunMode = 'statement' | 'all';

export interface CodeEditorHandle {
  view: EditorView | null;
  getSelectionText(): string;
  /** The selection if any, else the SQL statement at the cursor, else the whole document. */
  getRunText(): string;
  replaceRange(from: number, to: number, text: string): void;
  /** Formats the selection if any, else the whole document, as one undoable change. No-op when nothing changes. */
  format(options: SqlFormatOptions): void;
  focus(): void;
  /** Selects from..to (or puts the cursor at from), scrolls it to the center and focuses the editor. */
  reveal(from: number, to?: number): void;
}

/** Where the main cursor is (1-based) and how much is selected, for a status bar. */
export interface SelectionInfo {
  line: number;
  col: number;
  /** Characters selected over all selections. */
  selected: number;
  selections: number;
  /** Offset of the main cursor. */
  pos: number;
}

export function selectionInfo(state: EditorState): SelectionInfo {
  const { main, ranges } = state.selection;
  const line = state.doc.lineAt(main.head);
  return { line: line.number, col: main.head - line.from + 1, selected: ranges.reduce((n, r) => n + r.to - r.from, 0), selections: ranges.length, pos: main.head };
}

/** Marks the transaction that loads an outside `value`, so it doesn't echo back through onChange. */
const external = Annotation.define<boolean>();

/** A CodeMirror 6 editor; one view for the component's lifetime, options swapped in place. */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  value, lang, onChange, onRun, readOnly = false, placeholder, sqlDialect, sqlSchema, height, autoFocus, onScroll, extensions, wrap = false, onSelection, options,
}, ref) {
  const contextOptions = useEditorOptions();
  const optionsExt = editorOptionsExtension(options ?? contextOptions);
  const optionsKey = JSON.stringify(options ?? contextOptions ?? null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const compartments = useRef({ lang: new Compartment(), readOnly: new Compartment(), placeholder: new Compartment(), extra: new Compartment(), options: new Compartment(), wrap: new Compartment() }).current;
  // The callbacks change every render; the view's extensions read them through this ref.
  const handlers = useRef({ onChange, onRun, onScroll, onSelection });
  handlers.current = { onChange, onRun, onScroll, onSelection };
  const langRef = useRef(lang);
  langRef.current = lang;

  const selectionText = (s: EditorState) => s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to)).join('\n');
  const runText = (s: EditorState) => {
    const selected = selectionText(s);
    if (selected.trim()) return selected;
    const doc = s.doc.toString();
    if (langRef.current !== 'sql') return doc;
    return statementAt(doc, s.selection.main.head)?.text ?? doc;
  };

  useImperativeHandle(ref, () => ({
    get view() {
      return view.current;
    },
    getSelectionText: () => (view.current ? selectionText(view.current.state) : ''),
    getRunText: () => (view.current ? runText(view.current.state) : ''),
    replaceRange: (from, to, text) => view.current?.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } }),
    format: (options) => {
      const v = view.current;
      if (!v) return;
      const { main } = v.state.selection;
      const from = main.empty ? 0 : main.from;
      const to = main.empty ? v.state.doc.length : main.to;
      const original = v.state.sliceDoc(from, to);
      const formatted = formatSql(original, options);
      if (formatted === original) return;
      v.dispatch({
        changes: { from, to, insert: formatted },
        selection: main.empty ? { anchor: Math.min(main.head, from + formatted.length) } : { anchor: from, head: from + formatted.length },
      });
    },
    focus: () => view.current?.focus(),
    reveal: (from, to) => {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = to === undefined ? a : Math.max(0, Math.min(to, len));
      v.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      v.focus();
    },
  }), []);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([
            { key: 'Mod-Enter', run: (ed) => {
              const onRun = handlers.current.onRun;
              if (!onRun) return false;
              onRun(runText(ed.state), 'statement');
              return true;
            } },
            { key: 'Mod-Shift-Enter', run: (ed) => {
              const onRun = handlers.current.onRun;
              if (!onRun) return false;
              onRun(ed.state.doc.toString(), 'all');
              return true;
            } },
          ])),
          compartments.options.of(optionsExt),
          history(),
          indentOnInput(),
          autocompletion(),
          highlightSelectionMatches(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          compartments.lang.of(languageFor(lang, { sqlDialect, sqlSchema })),
          compartments.readOnly.of(readOnlyExt(readOnly)),
          compartments.placeholder.of(placeholder ? placeholderExt(placeholder) : []),
          themeExtension,
          compartments.extra.of(extensions ?? []),
          compartments.wrap.of(wrap ? EditorView.lineWrapping : []),
          EditorView.domEventHandlers({
            scroll: (_e, ed) => {
              const { scrollTop, scrollHeight, clientHeight } = ed.scrollDOM;
              const range = scrollHeight - clientHeight;
              handlers.current.onScroll?.(range > 0 ? scrollTop / range : 0);
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged || u.selectionSet) handlers.current.onSelection?.(selectionInfo(u.state));
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(external))) return;
            handlers.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    handlers.current.onSelection?.(selectionInfo(v.state));
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // Created once; the effects below keep it in step with the props.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.lang.reconfigure(languageFor(lang, { sqlDialect, sqlSchema })) });
  }, [lang, sqlDialect, sqlSchema]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.options.reconfigure(optionsExt) });
  }, [optionsKey]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.extra.reconfigure(extensions ?? []) });
  }, [extensions]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.readOnly.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.placeholder.reconfigure(placeholder ? placeholderExt(placeholder) : []) });
  }, [placeholder]);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: external.of(true) });
  }, [value]);

  return <div ref={host} className="code-editor" style={height === undefined ? undefined : { height }} />;
});

const readOnlyExt = (readOnly: boolean) => EditorState.readOnly.of(readOnly);
