import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor, FilePreview, langOfFile, previewKind, type PreviewContent } from '@deckbuilder/editor';
import { type ApiError, errorOf, ErrorBanner, Icon, PanelBanner, PanelLoading, relPath, requestBlob, useDialogs, useKey } from '@deckbuilder/ui';
import { api, type LogSettings } from '../../api';
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
}

/** One open file: log files get the log viewer, the rest `TextFileTab`. */
export function FileTab(props: FileTabProps) {
  return previewKind(relPath.basename(props.path)) === 'log' ? <LogTab {...props} /> : <TextFileTab {...props} />;
}

/** A preview by extension, and for text files an editor with Save (Ctrl+S). */
function TextFileTab({ project, projectName, path, focused }: FileTabProps) {
  const name = relPath.basename(path);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError>();
  const generation = useRef(0);
  const editingRef = useRef(false);
  const blobUrl = useRef<string>();
  const { confirm, element } = useDialogs();

  const revoke = () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = undefined;
  };

  editingRef.current = editing;

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setState({ status: 'loading' });
    setEditing(false);
    setSaveError(undefined);
    try {
      if (previewKind(name) === 'image') {
        const url = URL.createObjectURL(await requestBlob('/api/fs/raw', { root: project, path }));
        if (gen !== generation.current) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke();
        blobUrl.current = url;
        setState({ status: 'ready', content: { url }, mtime: 0 });
      } else {
        const read = await api.fsRead(project, path);
        if (gen === generation.current) setState({ status: 'ready', content: read, mtime: read.mtime });
      }
    } catch (err) {
      if (gen === generation.current) setState({ status: 'error', error: errorOf(err) });
    }
  }, [project, path, name]);

  useEffect(() => {
    if (!editingRef.current) void load();
  }, [load]);
  useEffect(() => () => {
    generation.current++;
    revoke();
  }, []);

  const content = state.status === 'ready' ? state.content : undefined;
  const text = content && 'text' in content ? content.text : undefined;
  const editable = text !== undefined && !(content && 'truncated' in content && content.truncated);
  const dirty = editing && text !== undefined && draft !== text;

  const confirmDiscard = async () =>
    !dirty || confirm({ title: t('explorer.discardTitle'), body: t('explorer.discardBody', { name }), okLabel: t('explorer.discard'), danger: true });

  const toggleEdit = async () => {
    if (!editing) {
      setDraft(text ?? '');
      setSaveError(undefined);
      setEditing(true);
      return;
    }
    if (!(await confirmDiscard())) return;
    setSaveError(undefined);
    setEditing(false);
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

  useKey((e) => {
    if (!focused || !editing || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    void save();
  });

  return (
    <div className="xp-file">
      {element}
      <div className="xp-bar">
        <span className="xp-path mono" title={`${projectName}/${path}`}>{projectName}/{path}</span>
        {editable && (
          <button className="btn btn-sm" onClick={toggleEdit}>
            <Icon name={editing ? 'search' : 'edit'} /> {editing ? t('explorer.preview') : t('explorer.edit')}
          </button>
        )}
        {editing && (
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
        {content && (editing
          ? <CodeEditor value={draft} lang={langOfFile(name)} onChange={setDraft} height="100%" autoFocus />
          : <FilePreview name={name} content={content} />)}
      </div>
    </div>
  );
}
