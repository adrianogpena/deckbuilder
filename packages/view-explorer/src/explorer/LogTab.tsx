import { useState } from 'react';
import {
  type ApiError,
  copyText,
  errorOf,
  ErrorBanner,
  type HighlightTerm,
  type LogBookmark,
  dialogs,
  LogView,
  MAX_LOG_KEY_CHARS,
  Button,
  PanelBanner,
  PanelLoading,
  type TabAction,
  useLogTail,
  validLogSettings,
} from '@kedalion/ui';
import { explorerApi as api, type LogSettings } from '../client';
import { t } from '../i18n';
import { useTabActions } from './tab-actions';

const COPY_CHUNK_BYTES = 20_000_000;
const COPY_MAX_BYTES = 50_000_000;

class RangeStale extends Error {}
class RangeTooLarge extends Error {}

interface LogTabProps {
  project: string;
  projectName: string;
  path: string;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  logs?: LogSettings;
  onLogsChange?: (logs: LogSettings) => void;
  onActions?: (actions: TabAction[]) => void;
}

/** Text from byte `from` to the end of the file as the first answer saw it. */
async function textFrom(project: string, path: string, from: number): Promise<string> {
  let text = '';
  let at = from;
  let total = 0;
  let size: number | undefined;
  for (;;) {
    const chunk = await api.fsTail(project, path, at, COPY_CHUNK_BYTES);
    if (chunk.reset) throw new RangeStale();
    size ??= chunk.size;
    text += chunk.text;
    total += chunk.to - at;
    if (total > COPY_MAX_BYTES) throw new RangeTooLarge();
    if (chunk.to >= size || chunk.to <= at) return text + (chunk.partial ?? '');
    at = chunk.to;
  }
}

const lineCount = (text: string) => (text.match(/\n/g)?.length ?? 0) + (text === '' || text.endsWith('\n') ? 0 : 1);

/** One open log file: followed live, with highlights and byte-offset bookmarks persisted in settings. */
export function LogTab({ project, path, focused, logs, onLogsChange, onActions }: LogTabProps) {
  const key = `${project}:${path}`;
  const [local, setLocal] = useState<LogSettings>({ highlights: [], bookmarks: {} });
  const state = logs ?? local;
  const [follow, setFollow] = useState(true);
  const [note, setNote] = useState<string>();
  const [actionError, setActionError] = useState<ApiError>();
  const tail = useLogTail((from) => api.fsTail(project, path, from), { key, paused: !focused });

  const change = (next: LogSettings) => (onLogsChange ?? setLocal)(validLogSettings(next) ?? next);
  const bookmarks = state.bookmarks[key] ?? [];

  const setBookmarks = (list: LogBookmark[]) => {
    const { [key]: _old, ...rest } = state.bookmarks;
    change({ ...state, bookmarks: list.length ? { ...rest, [key]: list } : rest });
  };

  const run = async (action: () => Promise<void>) => {
    setNote(undefined);
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      if (err instanceof RangeStale) setActionError(errorOf({ code: 'rangeStale' }));
      else if (err instanceof RangeTooLarge) setNote(t('explorer.logTooLarge'));
      else setActionError(errorOf(err));
    }
  };

  const copyFrom = (b: LogBookmark) =>
    run(async () => {
      const text = await textFrom(project, path, b.offset);
      await copyText(text);
      setNote(t('explorer.logCopied', { count: lineCount(text) }));
    });

  const saveFrom = (b: LogBookmark) =>
    run(async () => {
      const file = path.split('/').pop() ?? path;
      const dot = file.lastIndexOf('.');
      const target = await dialogs.saveAs({
        purpose: 'log-range',
        suggestedName: `${dot > 0 ? file.slice(0, dot) : file}-from-${b.offset}.log`,
        filters: [{ name: 'Log', patterns: ['*.log'] }],
      });
      if (target === null) return;
      const saved = await api.fsSaveRange(project, path, b.offset, target);
      setNote(t('explorer.logSaved', { path: saved.path }));
    });

  useTabActions([{ id: 'reload', group: 'menu', icon: 'refresh', label: t('explorer.reload'), run: tail.reload }], onActions);

  return (
    <div className="xp-file">
      {note && <div className="xp-bar muted">{note}</div>}
      {tail.rotated && (
        <PanelBanner tone="warn" icon="alert" action={<Button size="sm" onClick={tail.dismissRotated} title={t('explorer.logDismiss')}>{t('explorer.logDismiss')}</Button>}>
          {t('explorer.logRotated')}
        </PanelBanner>
      )}
      {actionError && <ErrorBanner error={actionError} compact />}
      <div className="xp-body">
        {tail.loading && !tail.lines.length && <PanelLoading />}
        {tail.error && <ErrorBanner error={tail.error} onRetry={tail.reload} />}
        <LogView
          lines={tail.lines}
          highlights={state.highlights}
          onHighlightsChange={(highlights: HighlightTerm[]) => change({ ...state, highlights })}
          follow={follow}
          onFollowChange={setFollow}
          bookmarks={key.length > MAX_LOG_KEY_CHARS ? undefined : bookmarks}
          onBookmarksChange={key.length > MAX_LOG_KEY_CHARS ? undefined : setBookmarks}
          endOffset={tail.end}
          onCopyFrom={(b) => void copyFrom(b)}
          onSaveFrom={(b) => void saveFrom(b)}
        />
      </div>
    </div>
  );
}
