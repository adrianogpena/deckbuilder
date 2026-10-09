import { SplitView, t } from '@deckbuilder/ui';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { CodeEditor } from './CodeEditor';
import { markdownLive } from './markdownLive';
import { MarkdownView } from './MarkdownView';

export type MarkdownMode = 'live' | 'edit' | 'split' | 'preview';

export const MARKDOWN_MODES: readonly MarkdownMode[] = ['live', 'edit', 'split', 'preview'];

export interface MarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  mode: MarkdownMode;
  onModeChange(mode: MarkdownMode): void;
  resolveImage?(src: string): string | null;
  autoFocus?: boolean;
  /** Wrap long lines in the editor; default on. */
  wrap?: boolean;
}

/** A markdown source editor and its rendered preview side by side, with an Edit / Split / Preview switch. */
export function MarkdownEditor({ value, onChange, mode, onModeChange, resolveImage, autoFocus, wrap = true }: MarkdownEditorProps) {
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
      onScroll={mode === 'split' ? syncScroll : undefined} extensions={mode === 'live' ? liveExt : undefined} />
  );
  const rendered = (
    <div key="preview" ref={preview} className="md-editor-preview">
      <MarkdownView markdown={deferred} resolveImage={resolveImage} />
    </div>
  );

  return (
    <div className="md-editor">
      <div className="md-editor-bar">
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
