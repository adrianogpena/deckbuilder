import { SplitView } from '@deckbuilder/ui';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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

const layoutListeners = new Set<(l: MarkdownLayout) => void>();

/** The markdown text column layout, kept in localStorage and shared by every editor of the page. */
export function useMarkdownLayout(): [MarkdownLayout, (l: MarkdownLayout) => void] {
  const [layout, setState] = useState<MarkdownLayout>(readLayout);
  useEffect(() => {
    layoutListeners.add(setState);
    return () => void layoutListeners.delete(setState);
  }, []);
  const set = (l: MarkdownLayout) => {
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* storage unavailable */ }
    for (const fn of layoutListeners) fn(l);
  };
  return [layout, set];
}

export interface MarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  /** The view; the host shows the switch (and the layout choice) itself. */
  mode: MarkdownMode;
  layout?: MarkdownLayout;
  resolveImage?(src: string): string | null;
  autoFocus?: boolean;
  /** Wrap long lines in the editor; default on. */
  wrap?: boolean;
  onSelection?(info: SelectionInfo): void;
}

/** A markdown editor in one of four views: Live (rendered while editing), Source, Split (source and preview) or Preview. */
export function MarkdownEditor({ value, onChange, mode, layout = 'center', resolveImage, autoFocus, wrap = true, onSelection }: MarkdownEditorProps) {
  const deferred = useDeferredValue(value);
  const preview = useRef<HTMLDivElement>(null);
  const liveExt = useMemo(() => markdownLive(resolveImage), [resolveImage]);
  const [sizes, setSizes] = useState([0.5, 0.5]);

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
    <div className="md-editor" data-layout={layout} data-mode={mode}>
      <div className="md-editor-body">
        {mode === 'edit' || mode === 'live' ? editor
          : mode === 'preview' ? rendered
            : <SplitView direction="row" sizes={sizes} defaultSizes={[0.5, 0.5]} min={[200, 200]} onResize={setSizes}>{editor}{rendered}</SplitView>}
      </div>
    </div>
  );
}
