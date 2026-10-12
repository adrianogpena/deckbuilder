import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyEol, CodeEditor, detectEol, type Eol, FilePreview, HEX_LIMIT, langOfFile, MarkdownEditor, type MarkdownMode, normalizeEol, prepareForSave, previewKind,
  type PreviewContent,
} from '@deckbuilder/editor';
import { type ApiError, errorOf, ErrorBanner, FILE_DEFAULTS, type FileSettings, Icon, PanelBanner, PanelLoading, relPath, requestBlob, useCommand, useDialogs } from '@deckbuilder/ui';
import { api, type LogSettings, type TextEncoding } from '../../api';
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
  /** Save behaviour (auto-save, trim, final newline). */
  files?: Required<FileSettings>;
}

/** Line breaks of new files and of files without any: the OS's, like VS Code's `files.eol: auto`. */
const OS_EOL: Eol = typeof navigator !== 'undefined' && /^Win/.test(navigator.platform) ? '\r\n' : '\n';
const AUTO_SAVE_DELAY = 1000;

/** Text kinds whose tab opens in the preview (the toggle switches to the editor). */
const PREVIEW_FIRST = new Set(['table', 'notebook', 'har']);
/** Text kinds with a preview the toggle can switch to. */
const TOGGLES = new Set(['json', 'env', 'table', 'notebook', 'har']);
const BLOB_KINDS = new Set(['image', 'svg', 'audio', 'video']);

/** One open file: log files get the log viewer, the rest `TextFileTab`. */
export function FileTab(props: FileTabProps) {
  return previewKind(relPath.basename(props.path)) === 'log' ? <LogTab {...props} /> : <TextFileTab {...props} />;
}

/** A preview by extension, and for text files an editor with Save (Ctrl+S). */
function TextFileTab({ project, projectName, path, focused, markdownMode = 'live', onMarkdownModeChange, wrapLines = true, onWrapLinesChange, files = FILE_DEFAULTS }: FileTabProps) {
  const name = relPath.basename(path);
  const markdown = previewKind(name) === 'markdown';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [previewing, setPreviewing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError>();
  /** How the file is stored on disk; the editor always holds `\n` breaks. */
  const format = useRef<{ encoding: TextEncoding; eol: Eol }>({ encoding: 'utf8', eol: OS_EOL });
  const generation = useRef(0);
  const dirtyRef = useRef(false);
  const blobUrl = useRef<string>();
  const { confirm, element } = useDialogs();

  const revoke = () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = undefined;
  };

  const load = useCallback(async (silent = false) => {
    const gen = ++generation.current;
    if (!silent) {
      setState({ status: 'loading' });
      setPreviewing(PREVIEW_FIRST.has(previewKind(name)));
      setSaveError(undefined);
    }
    try {
      const kind = previewKind(name);
      if (BLOB_KINDS.has(kind)) {
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
      } else if (kind === 'font' || kind === 'hex') {
        const limit = kind === 'hex' ? HEX_LIMIT : undefined;
        const bytes = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path, limit })).arrayBuffer());
        if (gen === generation.current) setState({ status: 'ready', content: { bytes }, mtime: 0 });
      } else if (kind === 'sqlite') {
        const sqlite = await api.fsSqlite(project, path);
        const load = (table: string, offset: number) => api.fsSqlite(project, path, table, offset);
        if (gen === generation.current) setState({ status: 'ready', content: { sqlite, load }, mtime: 0 });
      } else {
        const read = await api.fsRead(project, path);
        let content: PreviewContent = read;
        if ('text' in read) {
          format.current = { encoding: read.encoding, eol: detectEol(read.text, OS_EOL) };
          content = { ...read, text: normalizeEol(read.text) };
        }
        if ('binary' in read) {
          try {
            const bytes = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path, limit: HEX_LIMIT })).arrayBuffer());
            content = { bytes };
          } catch {
            content = read;
          }
        }
        if (gen === generation.current) {
          if ('text' in content) setDraft(content.text);
          setState({ status: 'ready', content, mtime: read.mtime });
        }
      }
    } catch (err) {
      if (gen === generation.current) setState({ status: 'error', error: errorOf(err) });
    }
  }, [project, path, name]);

  useEffect(() => {
    if (!dirtyRef.current) void load();
  }, [load]);
  const known = useRef<string>();
  useEffect(() => {
    known.current = undefined;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const st = await api.fsStat(project, path);
        const stamp = `${st.mtime}:${st.size}`;
        const prev = known.current;
        if (prev === stamp) return;
        if (prev !== undefined && dirtyRef.current) return;
        known.current = stamp;
        if (prev !== undefined) void load(true);
      } catch {
        // the file may be mid-write or gone; the next tick retries
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [project, path, load]);
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
    const typed = draft;
    const text = prepareForSave(typed, { trim: files.trimTrailingWhitespace, finalNewline: files.insertFinalNewline, markdown });
    try {
      const saved = await api.fsWrite(project, path, applyEol(text, format.current.eol), state.mtime, format.current.encoding);
      // Our own write is no change on disk for the poll below.
      known.current = `${saved.mtime}:${saved.size}`;
      setDraft((d) => (d === typed ? text : d));
      setState({ status: 'ready', content: { text }, mtime: saved.mtime });
    } catch (err) {
      setSaveError(errorOf(err));
    } finally {
      setSaving(false);
    }
  };

  useCommand(commandById('explorer.file.save'), () => void save(), { enabled: focused && active });

  const saveRef = useRef(save);
  saveRef.current = save;
  const conflict = saveError?.code === 'fileChanged';
  useEffect(() => {
    if (files.autoSave !== 'afterDelay' || !dirty || conflict) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTO_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, conflict, files.autoSave]);
  useEffect(() => {
    if (files.autoSave !== 'onFocusChange') return;
    if (!focused) void saveRef.current();
    const onBlur = () => void saveRef.current();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [focused, files.autoSave]);

  return (
    <div className="xp-file">
      {element}
      <div className="xp-bar">
        <span className="xp-path mono" title={`${projectName}/${path}`}>{projectName}/{path}</span>
        {editable && TOGGLES.has(previewKind(name)) && (
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
      {conflict ? (
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
