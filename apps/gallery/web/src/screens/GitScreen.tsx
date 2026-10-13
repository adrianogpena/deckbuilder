import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffMode, DiffViewHandle } from '@deckbuilder/editor';
import type { GitFile, GitRepoInfo, GitStatus } from '@deckbuilder/server-core/protocol';
import { type ApiError, copyText, Empty, ErrorBanner, errorMessage, errorOf, Icon, PageHead, PanelBanner, useCommand, useRovingList, useToast } from '@deckbuilder/ui';
import { api, type Settings } from '../api';
import { commandById } from '../commands';
import { requestExplorer } from '../explorer-request';
import { t } from '../i18n';
import type { ScreenId } from '../nav';
import { GitDiffPane } from './git/GitDiffPane';
import { statusOf } from './git/sides';

interface Repo {
  info: GitRepoInfo;
  name: string;
  status?: GitStatus;
  error?: ApiError;
}

interface Selection {
  root: string;
  file: GitFile;
}

const GROUPS = ['conflict', 'staged', 'unstaged', 'untracked'] as const;
const keyOf = (root: string, file: GitFile) => `${root}\0${file.group}\0${file.path}`;

/** Changed files of every project that is a Git repository, with the diff of the selected one. Read-only. */
export function GitScreen({ go, initialDiffMode = 'split' }: { settings: Settings; go: (screen: ScreenId) => void; initialDiffMode?: DiffMode }) {
  const [repos, setRepos] = useState<Repo[]>();
  const [loadError, setLoadError] = useState<ApiError>();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Selection>();
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<DiffMode>(initialDiffMode);
  const diff = useRef<DiffViewHandle>(null);
  const list = useRef<HTMLElement>(null);
  const seq = useRef(0);
  const toast = useToast();
  useRovingList(list, '.git-file');

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const [projects, infos] = await Promise.all([api.projects(), api.gitRepos()]);
      const names = new Map(projects.map((p) => [p.id, p.name]));
      const next = await Promise.all(
        infos.map(async (info): Promise<Repo> => {
          const name = names.get(info.root) ?? info.root;
          if (!info.repo) return { info, name };
          try {
            return { info, name, status: await api.gitStatus(info.root) };
          } catch (e) {
            return { info, name, error: errorOf(e) };
          }
        }),
      );
      if (mine !== seq.current) return;
      setRepos(next);
      setLoadError(undefined);
      setSelected((sel) => {
        if (!sel) return sel;
        const file = next.find((r) => r.info.root === sel.root)?.status?.files.find((f) => keyOf(sel.root, f) === keyOf(sel.root, sel.file));
        return file ? { root: sel.root, file } : undefined;
      });
      setTick((n) => n + 1);
    } catch (e) {
      if (mine === seq.current) setLoadError(errorOf(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // On screen show and whenever the window gets the focus back; no polling.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useCommand(commandById('git.refresh'), () => void refresh());
  useCommand(commandById('git.nextChange'), () => void diff.current?.next(), { enabled: !!selected });
  useCommand(commandById('git.prevChange'), () => void diff.current?.prev(), { enabled: !!selected });

  const copyPatch = async () => {
    if (!selected) return;
    try {
      const patch = await api.gitDiff(selected.root, selected.file.path, selected.file.group === 'staged');
      if (!patch.text) return toast({ message: t('git.noPatch') });
      await copyText(patch.text);
      toast({ message: t(patch.truncated ? 'git.patchTruncated' : 'git.patchCopied') });
    } catch (e) {
      toast({ message: errorMessage(errorOf(e)), kind: 'error' });
    }
  };

  const toExplorer = (open: boolean) => {
    if (!selected) return;
    requestExplorer({ project: selected.root, path: selected.file.path, open });
    go('explorer');
  };
  const deleted = !!selected && (selected.file.group === 'staged' ? selected.file.index === 'D' : selected.file.worktree === 'D');

  // Git missing (or another failure shared by every folder) is one banner, not a reason on each.
  const errors = repos?.filter((r) => !r.info.repo).map((r) => r.info.error) ?? [];
  const shared = repos && errors.length > 0 && errors.length === repos.length && errors[0] && errors.every((e) => e === errors[0]) ? errors[0] : undefined;

  return (
    <div className="content">
      <PageHead title={t('nav.git')}>
        <div className="row">
          <button className="btn btn-sm" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" /> {t('git.refresh')}</button>
          <button className="btn btn-sm" onClick={() => void copyPatch()} disabled={!selected}>{t('git.copyPatch')}</button>
          <button className="btn btn-sm" onClick={() => toExplorer(true)} disabled={!selected || deleted}>{t('git.openFile')}</button>
          <button className="btn btn-sm" onClick={() => toExplorer(false)} disabled={!selected || deleted}>{t('git.reveal')}</button>
        </div>
      </PageHead>
      {loadError && <ErrorBanner error={loadError} onRetry={() => void refresh()} />}
      {shared && <PanelBanner tone="err">{shared}</PanelBanner>}
      <div className="rest-body">
        <aside className="rest-list git-list" ref={list}>
          {repos?.length === 0 && <p className="muted">{t('git.noProjects')}</p>}
          {repos?.map((repo) => (
            <section key={repo.info.root} className={repo.info.repo ? 'git-repo' : 'git-repo muted'}>
              <div className="git-repo-head" title={repo.info.upstream}>
                <Icon name="git-branch" />
                <span className="rest-item-name"><strong>{repo.name}</strong></span>
                {repo.status && <span className="muted">{repo.status.branch}</span>}
                {!!repo.status?.ahead && <span className="muted" title={t('git.ahead')}>↑{repo.status.ahead}</span>}
                {!!repo.status?.behind && <span className="muted" title={t('git.behind')}>↓{repo.status.behind}</span>}
              </div>
              {!repo.info.repo && !shared && <p className="git-reason">{repo.info.error ?? t('git.notRepo')}</p>}
              {repo.error && <ErrorBanner error={repo.error} compact />}
              {repo.status && repo.status.files.length === 0 && <p className="git-reason">{t('git.clean')}</p>}
              {repo.status && GROUPS.map((group) => {
                const files = repo.status!.files.filter((f) => f.group === group);
                if (!files.length) return null;
                return (
                  <div key={group} className="git-group">
                    <span className="mono-label">{t(`git.group.${group}`)} ({files.length})</span>
                    {files.map((file) => {
                      const key = keyOf(repo.info.root, file);
                      const active = !!selected && keyOf(selected.root, selected.file) === key;
                      const { letter, tone } = statusOf(file);
                      const name = file.path.split('/').pop();
                      return (
                        <button
                          key={key}
                          className={`git-file rest-item-main${active ? ' active' : ''}`}
                          title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                          onClick={() => setSelected({ root: repo.info.root, file })}
                          onFocus={() => setSelected({ root: repo.info.root, file })}
                        >
                          <span className="rest-item-name">{name} <span className="muted">{file.path.slice(0, -(name?.length ?? 0))}</span></span>
                          <span className={`git-letter ${tone}`}>{letter}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          ))}
        </aside>
        <div className="git-diff">
          {selected ? (
            <GitDiffPane key={keyOf(selected.root, selected.file)} ref={diff} root={selected.root} file={selected.file} tick={tick} mode={mode} onModeChange={setMode} />
          ) : (
            <Empty title={t('git.pick')} />
          )}
        </div>
      </div>
    </div>
  );
}
