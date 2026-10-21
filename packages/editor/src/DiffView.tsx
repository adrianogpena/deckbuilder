import { getOriginalDoc, goToNextChunk, goToPreviousChunk, MergeView, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { searchKeymap } from '@codemirror/search';
import { ChangeSet, Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { Button } from '@deckbuilderkit/ui';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { type Lang, languageFor } from './languages';
import { themeExtension } from './theme';

export type DiffMode = 'split' | 'inline';

/** Imperative API: move the selection to the next/previous change (F7 / Shift+F7). */
export interface DiffViewHandle {
  next(): boolean;
  prev(): boolean;
}

export interface DiffViewProps {
  original: string;
  modified: string;
  lang?: Lang;
  mode: DiffMode;
  /** When given, a Split/Inline toggle is shown above the diff. */
  onModeChange?: (mode: DiffMode) => void;
  modeLabels?: { split: string; inline: string };
}

const COLLAPSE = { margin: 3, minSize: 4 };
const chunkKeys = keymap.of([{ key: 'F7', run: goToNextChunk, shift: goToPreviousChunk }, ...searchKeymap]);

const baseExt = (lang: Compartment, l: Lang): Extension => [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  drawSelection(),
  lineNumbers(),
  chunkKeys,
  lang.of(languageFor(l)),
  themeExtension,
];

const replaceAll = (v: EditorView, text: string) => {
  if (v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
};

/** Read-only diff of two strings: side by side (`split`) or unified (`inline`). */
export const DiffView = forwardRef<DiffViewHandle, DiffViewProps>(function DiffView(
  { original, modified, lang = 'text', mode, onModeChange, modeLabels = { split: 'Split', inline: 'Inline' } },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const unified = useRef<EditorView | null>(null);
  const langA = useRef(new Compartment()).current;
  const langB = useRef(new Compartment()).current;
  const latest = useRef({ original, modified, lang });
  latest.current = { original, modified, lang };

  useEffect(() => {
    const { original, modified, lang } = latest.current;
    if (mode === 'split') {
      merge.current = new MergeView({
        parent: host.current!,
        a: { doc: original, extensions: baseExt(langA, lang) },
        b: { doc: modified, extensions: baseExt(langB, lang) },
        collapseUnchanged: COLLAPSE,
        highlightChanges: true,
        gutter: true,
      });
    } else {
      unified.current = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: modified,
          extensions: [baseExt(langB, lang), unifiedMergeView({ original, mergeControls: false, collapseUnchanged: COLLAPSE })],
        }),
      });
    }
    return () => {
      merge.current?.destroy();
      unified.current?.destroy();
      merge.current = null;
      unified.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const m = merge.current;
    if (m) {
      replaceAll(m.a, original);
      replaceAll(m.b, modified);
      return;
    }
    const u = unified.current;
    if (!u) return;
    const old = getOriginalDoc(u.state);
    if (old.toString() !== original) {
      const changes = ChangeSet.of({ from: 0, to: old.length, insert: original }, old.length);
      u.dispatch({ effects: originalDocChangeEffect(u.state, changes) });
    }
    replaceAll(u, modified);
  }, [original, modified]);

  useEffect(() => {
    const m = merge.current;
    if (m) {
      m.a.dispatch({ effects: langA.reconfigure(languageFor(lang)) });
      m.b.dispatch({ effects: langB.reconfigure(languageFor(lang)) });
    } else unified.current?.dispatch({ effects: langB.reconfigure(languageFor(lang)) });
  }, [lang]);

  useImperativeHandle(ref, () => {
    const target = () => {
      const m = merge.current;
      if (m) return m.a.hasFocus ? m.a : m.b;
      return unified.current;
    };
    const run = (cmd: typeof goToNextChunk) => {
      const v = target();
      if (!v) return false;
      v.focus();
      return cmd(v);
    };
    return { next: () => run(goToNextChunk), prev: () => run(goToPreviousChunk) };
  }, []);

  return (
    <div className="diff-view">
      {onModeChange && (
        <div className="diff-view-bar" role="group">
          {(['split', 'inline'] as const).map((m) => (
            <Button title={modeLabels[m]} key={m} variant="ghost" size="sm" pressed={m === mode} onClick={() => onModeChange(m)}>
              {modeLabels[m]}
            </Button>
          ))}
        </div>
      )}
      <div ref={host} className={`diff-view-body diff-${mode}`} />
    </div>
  );
});
