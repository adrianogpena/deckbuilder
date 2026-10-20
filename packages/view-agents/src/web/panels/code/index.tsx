import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { langOfFile } from '@deckbuilderkit/editor';
import { type ApiError, ErrorBanner, errorOf, PanelLoading } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { fs, relativeTo } from './fs';
import './style.css';

const CodeEditor = lazy(() => import('@deckbuilderkit/editor').then((m) => ({ default: m.CodeEditor })));

type Loaded = { text: string; readOnly: boolean } | { binary: true };

/** A project file in an editor with save; a change on disk shows a Reload / Keep mine bar and never overwrites silently. */
function CodePanel({ project, params, visible }: PanelProps) {
  const raw = typeof params.path === 'string' ? params.path : '';
  const path = relativeTo(project, raw);
  const [loaded, setLoaded] = useState<Loaded>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<ApiError>();
  const [stale, setStale] = useState(false);
  const mtime = useRef(0);
  const dirty = loaded !== undefined && !('binary' in loaded) && draft !== loaded.text;

  const load = useCallback(async () => {
    if (path === undefined) return;
    try {
      const r = await fs.read(project, path);
      setError(undefined);
      setStale(false);
      mtime.current = r.mtime;
      if ('binary' in r) return setLoaded({ binary: true });
      setLoaded({ text: r.text, readOnly: r.truncated || r.readOnly === true });
      setDraft(r.text);
    } catch (err) {
      setError(errorOf(err));
    }
  }, [project, path]);

  useEffect(() => {
    setLoaded(undefined);
    void load();
  }, [load]);

  useEffect(() => {
    if (!visible || path === undefined || !loaded) return;
    const id = setInterval(() => {
      fs.stat(project, path).then(
        (e) => e.mtime !== mtime.current && setStale(true),
        () => undefined,
      );
    }, 2500);
    return () => clearInterval(id);
  }, [visible, project, path, loaded]);

  const save = useCallback(async () => {
    if (path === undefined || !loaded || 'binary' in loaded) return;
    try {
      const e = await fs.write(project, path, draft, mtime.current);
      mtime.current = e.mtime;
      setLoaded({ ...loaded, text: draft });
      setError(undefined);
    } catch (err) {
      const info = errorOf(err);
      if (info.code === 'fileChanged') setStale(true);
      else setError(info);
    }
  }, [project, path, loaded, draft]);

  const external = useCallback(async () => {
    if (path === undefined) return;
    try {
      const ed = (await fs.editors()).find((e) => e.path);
      if (ed) await fs.openInEditor(ed.id, project, path);
      else setError({ kind: 'invalid', code: 'raw', message: t('panel.code.noEditor') });
    } catch (err) {
      setError(errorOf(err));
    }
  }, [project, path]);

  if (path === undefined) return <div className="agents-panel-code agents-code-note">{t('panel.code.outside')}</div>;
  return (
    <div
      className="agents-panel-code"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="agents-code-bar">
        <span className="agents-code-path" title={path}>
          {path}
          {dirty ? ' •' : ''}
        </span>
        <button type="button" className="agents-empty-btn" disabled={!dirty} onClick={() => void save()}>
          {t('panel.code.save')}
        </button>
        <button type="button" className="agents-empty-btn" onClick={() => void external()}>
          {t('panel.code.external')}
        </button>
      </div>
      {stale && (
        <div className="agents-code-changed" role="alert">
          <span>{t('panel.code.changed')}</span>
          <button type="button" className="agents-empty-btn" onClick={() => void load()}>
            {t('panel.code.reload')}
          </button>
          <button type="button" className="agents-empty-btn" onClick={() => setStale(false)}>
            {t('panel.code.keep')}
          </button>
        </div>
      )}
      {error && <ErrorBanner error={error} />}
      {!loaded ? (
        error ? null : <PanelLoading />
      ) : 'binary' in loaded ? (
        <div className="agents-code-note">{t('panel.code.binary')}</div>
      ) : (
        <div className="agents-code-editor">
          <Suspense fallback={<PanelLoading />}>
            <CodeEditor value={draft} lang={langOfFile(path)} onChange={setDraft} readOnly={loaded.readOnly} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'code',
  titleKey: 'panel.code.title',
  icon: 'code',
  placement: 'center',
  Panel: CodePanel,
};
