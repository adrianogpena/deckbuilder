import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers as lineNumbersExt } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { type Lang, languageFor } from './languages';
import { themeExtension } from './theme';

/** Characters; longer documents render as a plain `<pre>`. */
export const CODE_VIEW_LIMIT = 2_000_000;

const optionsExt = (lang: Lang, wrap: boolean, lineNumbers: boolean) => [
  languageFor(lang),
  wrap ? EditorView.lineWrapping : [],
  lineNumbers ? lineNumbersExt() : [],
];

/** Read-only, highlighted text (searchable with Mod-f). */
export function CodeView({ value, lang, wrap = false, lineNumbers = false }: { value: string; lang: Lang; wrap?: boolean; lineNumbers?: boolean }) {
  if (value.length > CODE_VIEW_LIMIT) return <pre className={wrap ? 'code-view-plain wrap' : 'code-view-plain'}>{value}</pre>;
  return <HighlightedView value={value} lang={lang} wrap={wrap} lineNumbers={lineNumbers} />;
}

function HighlightedView({ value, lang, wrap, lineNumbers }: { value: string; lang: Lang; wrap: boolean; lineNumbers: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const options = useRef(new Compartment()).current;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          EditorState.readOnly.of(true),
          drawSelection(),
          keymap.of(searchKeymap),
          options.of(optionsExt(lang, wrap, lineNumbers)),
          themeExtension,
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: options.reconfigure(optionsExt(lang, wrap, lineNumbers)) });
  }, [lang, wrap, lineNumbers]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = view.current;
    if (!v || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'f') return;
    e.preventDefault();
    v.focus();
    openSearchPanel(v);
  };

  return <div ref={host} className="code-view" tabIndex={-1} onKeyDown={onKeyDown} onMouseDown={(e) => { if (e.target === host.current) view.current?.focus(); }} />;
}
