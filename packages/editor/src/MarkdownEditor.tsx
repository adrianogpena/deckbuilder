import { SplitView, t } from '@deckbuilder/ui';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { CodeEditor, type SelectionInfo } from './CodeEditor';
import { markdownLive } from './markdownLive';
import { MarkdownView } from './MarkdownView';

export type MarkdownMode = 'live' | 'edit' | 'split' | 'preview';

export const MARKDOWN_MODES: readonly MarkdownMode[] = ['live', 'edit', 'split', 'preview'];

/** Where the text column sits in the Live and Preview views; `full` fits it to the width. */
export type MarkdownLayout = 'left' | 'center' | 'full';

export const MARKDOWN_LAYOUTS: readonly MarkdownLayout[] = ['left', 'center', 'full'];

const LAYOUT_KEY = 'deckbuilder.markdownLayout';

function readLayout(): MarkdownLayout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return MARKDOWN_LAYOUTS.find((l) => l === v) ?? 'center';
  } catch {
    return 'center';
  }
}

export interface MarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  mode: MarkdownMode;
  onModeChange(mode: MarkdownMode): void;
  resolveImage?(src: string): string | null;
  autoFocus?: boolean;
  /** Wrap long lines in the editor; default on. */
  wrap?: boolean;
  onSelection?(info: SelectionInfo): void;
}

/** A markdown source editor and its rendered preview side by side, with an Edit / Split / Preview switch. */
export function MarkdownEditor({ value, onChange, mode, onModeChange, resolveImage, autoFocus, wrap = true, onSelection }: MarkdownEditorProps) {
  const deferred = useDeferredValue(value);
  const preview = useRef<HTMLDivElement>(null);
  const liveExt = useMemo(() => markdownLive(resolveImage), [resolveImage]);
  const [sizes, setSizes] = useState([0.5, 0.5]);
  const [layout, setLayoutState] = useState<MarkdownLayout>(readLayout);
  const setLayout = (l: MarkdownLayout) => {
    setLayoutState(l);
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* storage unavailable */ }
  };

  // Proportional: the preview sits at the same fraction of its range as the editor.
  const syncScroll = (fraction: number) => {
    const el = preview.current;
    if (el) el.scrollTop = fraction * (el.scrollHeight - el.clientHeight);
  };

  const editor = (
    <CodeEditor key="editor" value={value} lang="markdown" onChange={onChange} height="100%" autoFocus={autoFocus} wrap={wrap}
      onScroll={mode === 'split' ? syncScroll : undefined} extensions={mode === 'live' ? liveExt : undefined} onSelection={onSelection} />
  );
  const rendered = (
    <div key="preview" ref={preview} className="md-editor-preview">
      <MarkdownView markdown={deferred} resolveImage={resolveImage} />
    </div>
  );

  return (
    <div className="md-editor" data-layout={layout}>
      <div className="md-editor-bar">
        <div className="md-editor-modes" role="group">
          {MARKDOWN_LAYOUTS.map((l) => (
            <button key={l} type="button" aria-pressed={layout === l} onClick={() => setLayout(l)}>{t(`preview.layout.${l}`)}</button>
          ))}
        </div>
        <div className="md-editor-modes" role="group">
          {MARKDOWN_MODES.map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => onModeChange(m)}>{t(`preview.mode.${m}`)}</button>
          ))}
        </div>
      </div>
      <div className="md-editor-body">
        {mode === 'edit' || mode === 'live' ? editor
          : mode === 'preview' ? rendered
            : <SplitView direction="row" sizes={sizes} defaultSizes={[0.5, 0.5]} min={[200, 200]} onResize={setSizes}>{editor}{rendered}</SplitView>}
      </div>
    </div>
  );
}
