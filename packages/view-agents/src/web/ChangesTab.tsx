import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { type DiffMode, langOfFile } from '@deckbuilderkit/editor';
import type { GitFile, GitFileContent, GitStatus } from '@deckbuilderkit/server-core/protocol';
import { ErrorBanner, PanelLoading, request, useAsync, useViewLink } from '@deckbuilderkit/ui';
import { t } from '../i18n';

const DiffView = lazy(() => import('@deckbuilderkit/editor').then((m) => ({ default: m.DiffView })));

const gitClient = {
  gitStatus: (root: string) => request<GitStatus>('GET', '/api/git/status', { root }),
  gitFile: (root: string, path: string, from: 'head' | 'index') => request<GitFileContent>('GET', '/api/git/file', { root, path, from }),
  fsRead: (root: string, path: string) =>
    request<{ binary: true } | { text: string; truncated: boolean }>('GET', '/api/fs/read', { root, path }),
};

const EMPTY: GitFileContent = { text: '' };
const orEmpty = (side: GitFileContent) => (side.missing ? EMPTY : side);

async function working(root: string, path: string): Promise<GitFileContent> {
  const read = await gitClient.fsRead(root, path);
  if ('binary' in read) return { binary: true };
  return read.truncated ? { tooLarge: true } : { text: read.text };
}

async function sidesOf(root: string, file: GitFile): Promise<{ original: GitFileContent; modified: GitFileContent }> {
  if (file.group === 'conflict') return { original: EMPTY, modified: await working(root, file.path) };
  if (file.group === 'untracked') return { original: EMPTY, modified: await working(root, file.path) };
  if (file.group === 'staged') {
    const [original, modified] = await Promise.all([
      file.index === 'A' ? EMPTY : gitClient.gitFile(root, file.origPath ?? file.path, 'head').then(orEmpty),
      file.index === 'D' ? EMPTY : gitClient.gitFile(root, file.path, 'index').then(orEmpty),
    ]);
    return { original, modified };
  }
  const [original, modified] = await Promise.all([
    gitClient.gitFile(root, file.path, 'index').then(orEmpty),
    file.worktree === 'D' ? EMPTY : working(root, file.path),
  ]);
  return { original, modified };
}

const problemOf = (side?: GitFileContent) =>
  side?.binary ? t('agents.changes.binary') : side?.tooLarge ? t('agents.changes.tooLarge') : undefined;

const codeOf = (f: GitFile) => (f.group === 'untracked' ? '?' : f.group === 'conflict' ? '!' : f.group === 'staged' ? f.index : f.worktree);

function FileDiff({ root, file, tick }: { root: string; file: GitFile; tick: number }) {
  const [mode, setMode] = useState<DiffMode>('split');
  const sides = useAsync(() => sidesOf(root, file), [root, file.path, file.group, file.index, file.worktree, tick]);
  if (sides.error) return <ErrorBanner error={sides.error} onRetry={sides.reload} />;
  if (!sides.data) return <PanelLoading />;
  const { original, modified } = sides.data;
  const problem = problemOf(original) ?? problemOf(modified);
  if (problem) return <p className="agents-empty">{problem}</p>;
  return (
    <Suspense fallback={<PanelLoading />}>
      <DiffView
        original={original.text ?? ''}
        modified={modified.text ?? ''}
        lang={langOfFile(file.path.split('/').pop() ?? file.path)}
        mode={mode}
        onModeChange={setMode}
        modeLabels={{ split: t('agents.changes.split'), inline: t('agents.changes.inline') }}
      />
    </Suspense>
  );
}

export interface ChangesTabProps {
  /** Project path (or the session's cwd); absent when no session is selected. */
  root?: string;
  /** The selected session's status; a change away from `running` refreshes the list. */
  status?: string;
}

/** The Changes tab: files changed in the session's project, click one for its diff. */
export function ChangesTab({ root, status }: ChangesTabProps) {
  const openGit = useViewLink('git');
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<string>();
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current === 'running' && status !== 'running') setTick((n) => n + 1);
    prev.current = status;
  }, [status]);
  useEffect(() => setPicked(undefined), [root]);
  const state = useAsync(() => (root ? gitClient.gitStatus(root) : Promise.resolve(undefined)), [root, tick]);

  if (!root) return <p className="agents-empty agents-placeholder">{t('agents.panel.changes.empty')}</p>;
  const files = state.data?.files ?? [];
  const file = files.find((f) => f.path === picked);

  return (
    <div className="agents-changes">
      <div className="agents-changes-bar">
        <span className="agents-changes-branch">{state.data?.branch ?? ''}</span>
        <button type="button" className="agents-toggle" title={t('agents.changes.refresh')} aria-label={t('agents.changes.refresh')} onClick={() => setTick((n) => n + 1)}>
          ↻
        </button>
        {openGit && (
          <button type="button" title={t('agents.changes.openGit')} className="agents-changes-open" onClick={() => openGit()}>
            {t('agents.changes.openGit')}
          </button>
        )}
      </div>
      {state.error ? (
        <ErrorBanner error={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <PanelLoading />
      ) : files.length === 0 ? (
        <p className="agents-empty agents-placeholder">{t('agents.changes.clean')}</p>
      ) : (
        <>
          <ul className="agents-changes-list">
            {files.map((f) => (
              <li key={`${f.group}:${f.path}`}>
                <button type="button" className="agents-changes-file" aria-pressed={f.path === picked} title={f.path} onClick={() => setPicked(f.path === picked ? undefined : f.path)}>
                  <span className={`agents-changes-code agents-changes-${f.group}`}>{codeOf(f)}</span>
                  <span className="agents-changes-path">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
          {file && (
            <div className="agents-changes-diff">
              <FileDiff root={root} file={file} tick={tick} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
