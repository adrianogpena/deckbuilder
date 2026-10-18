import { PanelLoading } from '@deckbuilderkit/ui';
import { forwardRef, lazy, Suspense, useImperativeHandle, useMemo, useRef } from 'react';
import { CodeEditor, type SelectionInfo } from './CodeEditor';
import type { MarkdownMode, RichCommandId, RichHost } from './rich/commands';
import type { RichMarkdownHandle } from './rich/RichMarkdown';

/** Milkdown loads with the first rich pane, in its own chunk. */
const RichMarkdown = lazy(() => import('./rich/RichMarkdown').then((m) => ({ default: m.RichMarkdown })));

export interface MarkdownEditorHandle {
  /** Runs a markdown command in the rich pane; false in Source mode or when no feature handled it. */
  run(id: RichCommandId): boolean;
}

export interface MarkdownEditorProps {
  value: string;
  /** Fires only after a user edit; an untouched file keeps its text byte for byte. */
  onChange(value: string): void;
  /** The view; the host shows the Source toggle itself. */
  mode: MarkdownMode;
  host: RichHost;
  autoFocus?: boolean;
  /** Wrap long lines in Source mode; default on. */
  wrap?: boolean;
  /** Cursor and selection of Source mode. */
  onSelection?(info: SelectionInfo): void;
  /** Show the heading rail; overrides `host.settings.toc`. */
  toc?: boolean;
  /** Overrides `host.resolveImage`. */
  resolveImage?(src: string): string | null;
}

/** A markdown editor: the rich (Milkdown) pane, or the raw text in CodeMirror. */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor(
  { value, onChange, mode, host, autoFocus, wrap = true, onSelection, toc, resolveImage },
  ref,
) {
  const rich = useRef<RichMarkdownHandle>(null);
  useImperativeHandle(ref, () => ({ run: (id) => (mode === 'rich' && rich.current ? rich.current.run(id) : false) }), [mode]);
  const effective = useMemo<RichHost>(() => ({
    ...host,
    resolveImage: resolveImage ?? host.resolveImage,
    settings: toc === undefined ? host.settings : { ...host.settings, toc },
  }), [host, resolveImage, toc]);

  return (
    <div className="md-editor" data-mode={mode}>
      <div className="md-editor-body">
        {mode === 'source'
          ? <CodeEditor value={value} lang="markdown" onChange={onChange} height="100%" autoFocus={autoFocus} wrap={wrap} onSelection={onSelection} />
          : <Suspense fallback={<PanelLoading />}><RichMarkdown ref={rich} value={value} onChange={onChange} host={effective} autoFocus={autoFocus} /></Suspense>}
      </div>
    </div>
  );
});
