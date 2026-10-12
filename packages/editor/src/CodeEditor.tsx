import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderExt,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { type Lang, languageFor, type SqlDialect, type SqlSchema } from './languages';
import { themeExtension } from './theme';

export interface CodeEditorProps {
  value: string;
  lang: Lang;
  onChange?(value: string): void;
  /** Mod-Enter. */
  onRun?(value: string): void;
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
}

/** Where the main cursor is (1-based) and how much is selected, for a status bar. */
export interface SelectionInfo {
  line: number;
  col: number;
  /** Characters selected over all selections. */
  selected: number;
  selections: number;
}

export function selectionInfo(state: EditorState): SelectionInfo {
  const { main, ranges } = state.selection;
  const line = state.doc.lineAt(main.head);
  return { line: line.number, col: main.head - line.from + 1, selected: ranges.reduce((n, r) => n + r.to - r.from, 0), selections: ranges.length };
}

/** Marks the transaction that loads an outside `value`, so it doesn't echo back through onChange. */
const external = Annotation.define<boolean>();

/** A CodeMirror 6 editor; one view for the component's lifetime, options swapped in place. */
export function CodeEditor({
  value, lang, onChange, onRun, readOnly = false, placeholder, sqlDialect, sqlSchema, height, autoFocus, onScroll, extensions, wrap = false, onSelection,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const compartments = useRef({ lang: new Compartment(), readOnly: new Compartment(), placeholder: new Compartment(), extra: new Compartment(), wrap: new Compartment() }).current;
  // The callbacks change every render; the view's extensions read them through this ref.
  const handlers = useRef({ onChange, onRun, onScroll, onSelection });
  handlers.current = { onChange, onRun, onScroll, onSelection };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run: (ed) => {
            const onRun = handlers.current.onRun;
            if (!onRun) return false;
            onRun(ed.state.doc.toString());
            return true;
          } }])),
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
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
}

const readOnlyExt = (readOnly: boolean) => EditorState.readOnly.of(readOnly);
