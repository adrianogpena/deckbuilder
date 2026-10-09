import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor, FilePreview, langOfFile, MarkdownEditor, type MarkdownMode, previewKind, type PreviewContent } from '@deckbuilder/editor';
import { type ApiError, errorOf, ErrorBanner, Icon, PanelBanner, PanelLoading, relPath, requestBlob, useCommand, useDialogs } from '@deckbuilder/ui';
import { api, type LogSettings } from '../../api';
import { commandById } from '../../commands';
import { t } from '../../i18n';
import { LogTab } from './LogTab';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; content: PreviewContent; mtime: number };

export interface FileTabProps {
  project: string;
  projectName: string;
  path: string;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  /** Log viewer state (highlights, bookmarks) and its change handler; only log files use them. */
  logs?: LogSettings;
  onLogsChange?: (logs: LogSettings) => void;
  /** Mode of the markdown editor and its change handler. */
  markdownMode?: MarkdownMode;
  onMarkdownModeChange?: (mode: MarkdownMode) => void;
  /** Wrap long lines in the editors (default on) and its change handler. */
  wrapLines?: boolean;
  onWrapLinesChange?: (wrap: boolean) => void;
}

/** One open file: log files get the log viewer, the rest `TextFileTab`. */
export function FileTab(props: FileTabProps) {
  return previewKind(relPath.basename(props.path)) === 'log' ? <LogTab {...props} /> : <TextFileTab {...props} />;
}

/** A preview by extension, and for text files an editor with Save (Ctrl+S). */
function TextFileTab({ project, projectName, path, focused, markdownMode = 'live', onMarkdownModeChange, wrapLines = true, onWrapLinesChange }: FileTabProps) {
  const name = relPath.basename(path);
  const markdown = previewKind(name) === 'markdown';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [previewing, setPreviewing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError>();
  const generation = useRef(0);
  const dirtyRef = useRef(false);
  const blobUrl = useRef<string>();
  const { confirm, element } = useDialogs();

  const revoke = () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = undefined;
  };

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setState({ status: 'loading' });
    setPreviewing(false);
    setSaveError(undefined);
    try {
      const kind = previewKind(name);
      if (kind === 'image' || kind === 'svg') {
        const blob = await requestBlob('/api/fs/raw', { root: project, path });
        const source = kind === 'svg' ? await blob.text() : undefined;
        const url = URL.createObjectURL(blob);
        if (gen !== generation.current) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke();
        blobUrl.current = url;
        setState({ status: 'ready', content: { url, source }, mtime: 0 });
      } else if (kind === 'archive') {
        const archive = await api.fsArchive(project, path);
        if (gen === generation.current) setState({ status: 'ready', content: { archive }, mtime: 0 });
      } else if (kind === 'pdf') {
        const pdf = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path })).arrayBuffer());
        if (gen === generation.current) setState({ status: 'ready', content: { pdf }, mtime: 0 });
      } else {
        const read = await api.fsRead(project, path);
        if (gen === generation.current) {
          if ('text' in read) setDraft(read.text);
          setState({ status: 'ready', content: read, mtime: read.mtime });
        }
      }
    } catch (err) {
      if (gen === generation.current) setState({ status: 'error', error: errorOf(err) });
    }
  }, [project, path, name]);

  useEffect(() => {
    if (!dirtyRef.current) void load();
  }, [load]);
  useEffect(() => () => {
    generation.current++;
    revoke();
  }, []);

  const content = state.status === 'ready' ? state.content : undefined;
  const text = content && 'text' in content ? content.text : undefined;
  const editable = text !== undefined && !(content && 'truncated' in content && content.truncated);
  // Editable files open straight in the editor; only JSON can switch to its tree preview.
  const active = editable && !previewing;
  const mdEditor = markdown && active;
  const dirty = active && text !== undefined && draft !== text;
  dirtyRef.current = dirty;

  const confirmDiscard = async () =>
    !dirty || confirm({ title: t('explorer.discardTitle'), body: t('explorer.discardBody', { name }), okLabel: t('explorer.discard'), danger: true });

  const toggleEdit = async () => {
    if (previewing) {
      setDraft(text ?? '');
      setSaveError(undefined);
      setPreviewing(false);
      return;
    }
    if (!(await confirmDiscard())) return;
    setSaveError(undefined);
    setPreviewing(true);
  };

  const reload = async () => {
    if (await confirmDiscard()) void load();
  };

  const save = async () => {
    if (!dirty || saving || state.status !== 'ready') return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const saved = await api.fsWrite(project, path, draft, state.mtime);
      setState({ status: 'ready', content: { text: draft }, mtime: saved.mtime });
    } catch (err) {
      setSaveError(errorOf(err));
    } finally {
      setSaving(false);
    }
  };

  useCommand(commandById('explorer.file.save'), () => void save(), { enabled: focused && active });

  return (
    <div className="xp-file">
      {element}
      <div className="xp-bar">
        <span className="xp-path mono" title={`${projectName}/${path}`}>{projectName}/{path}</span>
        {editable && previewKind(name) === 'json' && (
          <button className="btn btn-sm" onClick={toggleEdit}>
            <Icon name={previewing ? 'edit' : 'search'} /> {previewing ? t('explorer.edit') : t('explorer.preview')}
          </button>
        )}
        {active && onWrapLinesChange && (
          <button className="btn btn-ghost btn-sm" onClick={() => onWrapLinesChange(!wrapLines)} aria-pressed={wrapLines}>
            {t('explorer.wrap')}
          </button>
        )}
        {active && (
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || saving}>
            {t('explorer.save')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={reload} title={t('explorer.reload')} aria-label={t('explorer.reload')}>
          <Icon name="refresh" />
        </button>
      </div>
      {saveError?.code === 'fileChanged' ? (
        <PanelBanner tone="err" icon="alert" action={<button className="btn btn-sm" onClick={reload}>{t('explorer.reload')}</button>}>
          {t('error.fileChanged')}
        </PanelBanner>
      ) : saveError && <ErrorBanner error={saveError} compact />}
      <div className="xp-body">
        {state.status === 'loading' && <PanelLoading />}
        {state.status === 'error' && <ErrorBanner error={state.error} onRetry={() => void load()} />}
        {content && (mdEditor
          ? <MarkdownEditor value={draft} onChange={setDraft} mode={markdownMode} onModeChange={(m) => onMarkdownModeChange?.(m)} wrap={wrapLines} autoFocus />
          : active
          ? <CodeEditor value={draft} lang={langOfFile(name)} onChange={setDraft} height="100%" wrap={wrapLines} autoFocus />
          : <FilePreview name={name} content={content} />)}
      </div>
    </div>
  );
}
