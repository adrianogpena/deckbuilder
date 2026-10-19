import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { langOfFile } from '@deckbuilderkit/editor';
import { type ApiError, ErrorBanner, errorOf, PanelLoading } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { fs, relativeTo } from '../files/fs';
import './style.css';

const CodeEditor = lazy(() => import('@deckbuilderkit/editor').then((m) => ({ default: m.CodeEditor })));
const MarkdownView = lazy(() => import('@deckbuilderkit/editor').then((m) => ({ default: m.MarkdownView })));

/** Read-only view of a project file that reloads when the file changes: Markdown rendered, anything else as code. */
function PreviewPanel({ project, params, visible }: PanelProps) {
  const raw = typeof params.path === 'string' ? params.path : '';
  const path = relativeTo(project, raw);
  const [text, setText] = useState<string>();
  const [binary, setBinary] = useState(false);
  const [error, setError] = useState<ApiError>();
  const mtime = useRef(-1);

  useEffect(() => {
    if (path === undefined) return;
    let alive = true;
    mtime.current = -1;
    setText(undefined);
    const tick = async () => {
      try {
        const e = await fs.stat(project, path);
        if (!alive || e.mtime === mtime.current) return;
        const r = await fs.read(project, path);
        if (!alive) return;
        mtime.current = r.mtime;
        setError(undefined);
        if ('binary' in r) setBinary(true);
        else {
          setBinary(false);
          setText(r.text);
        }
      } catch (err) {
        if (alive) setError(errorOf(err));
      }
    };
    void tick();
    const id = visible ? setInterval(() => void tick(), 1500) : undefined;
    return () => {
      alive = false;
      if (id !== undefined) clearInterval(id);
    };
  }, [project, path, visible]);

  if (path === undefined) return <div className="agents-panel-preview agents-preview-note">{t('panel.code.outside')}</div>;
  const markdown = /\.(md|markdown|mdx)$/i.test(path);
  return (
    <div className="agents-panel-preview">
      {error && <ErrorBanner error={error} />}
      {binary ? (
        <div className="agents-preview-note">{t('panel.code.binary')}</div>
      ) : text === undefined ? (
        error ? null : <PanelLoading />
      ) : (
        <div className="agents-preview-body">
          <Suspense fallback={<PanelLoading />}>
            {markdown ? <MarkdownView markdown={text} /> : <CodeEditor value={text} lang={langOfFile(path)} readOnly />}
          </Suspense>
        </div>
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'preview',
  titleKey: 'panel.preview.title',
  icon: 'preview',
  placement: 'both',
  Panel: PreviewPanel,
};
