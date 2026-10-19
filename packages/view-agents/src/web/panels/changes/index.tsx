import { useCallback, useEffect, useState } from 'react';
import type { GitFile } from '@deckbuilderkit/server-core/protocol';
import { errorOf, ErrorBanner, PanelLoading, useAsync, useDialogs, useToast } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps, WorkspaceApi } from '../../workspace/types';
import { codeOf, gitClient } from '../diff/git-client';
import { previewsOf } from '../diff/previews';
import { gitAction, listBranches } from './git-api';
import './style.css';

const POLL_MS = 3000;

type Group = 'staged' | 'unstaged' | 'untracked' | 'conflict';
const GROUPS: Array<{ group: Group; key: 'staged' | 'unstaged' | 'untracked' | 'conflict' }> = [
  { group: 'conflict', key: 'conflict' },
  { group: 'staged', key: 'staged' },
  { group: 'unstaged', key: 'unstaged' },
  { group: 'untracked', key: 'untracked' },
];

/** Opens the file's diff: a preview tab replacing the previous unpinned one, or a pinned tab (`pin`). */
function openDiff(api: WorkspaceApi, project: string, file: GitFile, pin: boolean) {
  if (!pin) for (const id of previewsOf(project)) api.close(id);
  api.open('diff', { path: file.path, group: file.group, ...(pin ? {} : { preview: true }) });
}

interface ChangesViewProps {
  project: string;
  api: WorkspaceApi;
  visible: boolean;
}

function ChangesView({ project, api, visible }: ChangesViewProps) {
  const toast = useToast();
  const dialogs = useDialogs();
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [visible, refresh]);
  const status = useAsync(() => gitClient.gitStatus(project), [project, tick]);
  const branches = useAsync(() => listBranches(project), [project, status.data?.branch]);

  const run = async (action: string, body?: Record<string, unknown>, done?: () => void) => {
    setBusy(true);
    try {
      await gitAction(action, project, body);
      done?.();
    } catch (e) {
      const err = errorOf(e);
      toast({ message: err.detail || err.message, kind: 'error' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (status.error && !status.data) return <ErrorBanner error={status.error} onRetry={status.reload} />;
  if (!status.data) return <PanelLoading />;
  const { files, branch, ahead, behind } = status.data;
  const staged = files.filter((f) => f.group === 'staged');
  const hasChanges = files.length > 0;

  const discard = async (list: GitFile[]) => {
    const ok = await dialogs.confirm({
      title: t('panel.changes.discard'),
      body: list.length === 1 ? list[0]!.path : t('panel.changes.discardMany', { n: list.length }),
      okLabel: t('panel.changes.discard'),
      danger: true,
    });
    if (!ok) return;
    const untracked = list.filter((f) => f.group === 'untracked').map((f) => f.path);
    const tracked = list.filter((f) => f.group !== 'untracked').map((f) => f.path);
    await run('discard', { paths: tracked, untracked });
  };

  const undo = async () => {
    const ok = await dialogs.confirm({ title: t('panel.changes.undo'), body: t('panel.changes.undoBody'), okLabel: t('panel.changes.undo'), danger: true });
    if (ok) await run('undo');
  };

  const commit = (push: boolean) =>
    run('commit', { message, amend, push }, () => {
      setMessage('');
      setAmend(false);
    });

  const newBranch = async () => {
    const name = await dialogs.prompt({ title: t('panel.changes.newBranch'), label: t('panel.changes.branchName') });
    if (name?.trim()) await run('checkout', { branch: name.trim(), create: true });
  };

  const canCommit = !busy && (amend || (message.trim() !== '' && staged.length > 0));

  return (
    <div className="agents-chg">
      {dialogs.element}
      <div className="agents-chg-bar">
        <select
          className="agents-chg-branch"
          aria-label={t('panel.changes.branch')}
          value={branch}
          disabled={busy}
          onChange={(e) => void run('checkout', { branch: e.target.value })}
        >
          {(branches.data ?? [{ name: branch, current: true }]).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => void newBranch()}>
          {t('panel.changes.newBranch')}
        </button>
        <span className="agents-chg-sync">{ahead || behind ? `↑${ahead} ↓${behind}` : ''}</span>
        <button type="button" disabled={busy} onClick={() => void run('pull')}>
          {t('panel.changes.pull')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('push')}>
          {t('panel.changes.push')}
        </button>
        <button type="button" disabled={busy || !hasChanges} onClick={() => void run('stash')}>
          {t('panel.changes.stash')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run('stash', { pop: true })}>
          {t('panel.changes.pop')}
        </button>
        <button type="button" title={t('agents.changes.refresh')} aria-label={t('agents.changes.refresh')} onClick={refresh}>
          ↻
        </button>
      </div>

      <div className="agents-chg-commit">
        <textarea
          value={message}
          rows={3}
          placeholder={t('panel.changes.message')}
          aria-label={t('panel.changes.message')}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="agents-chg-commit-row">
          <button type="button" disabled={!canCommit} onClick={() => void commit(false)}>
            {t('panel.changes.commit')}
          </button>
          <button type="button" disabled={!canCommit} onClick={() => void commit(true)}>
            {t('panel.changes.commitPush')}
          </button>
          <label className="agents-chg-amend">
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            {t('panel.changes.amend')}
          </label>
          <button type="button" disabled={busy} onClick={() => void undo()}>
            {t('panel.changes.undo')}
          </button>
        </div>
      </div>

      {!hasChanges ? (
        <p className="agents-empty agents-placeholder">{t('agents.changes.clean')}</p>
      ) : (
        <div className="agents-chg-groups">
          {GROUPS.map(({ group, key }) => {
            const list = files.filter((f) => f.group === group);
            if (list.length === 0) return null;
            return (
              <section key={group} className="agents-chg-group">
                <header className="agents-chg-head">
                  <span>
                    {t(`panel.changes.group.${key}`)} ({list.length})
                  </span>
                  {group === 'staged' ? (
                    <button type="button" disabled={busy} onClick={() => void run('unstage', { all: true })}>
                      {t('panel.changes.unstageAll')}
                    </button>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => void run('stage', { paths: list.map((f) => f.path) })}>
                        {t('panel.changes.stageAll')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => void discard(list)}>
                        {t('panel.changes.discardAll')}
                      </button>
                    </>
                  )}
                </header>
                <ul className="agents-chg-list">
                  {list.map((f) => (
                    <li key={`${f.group}:${f.path}`} className="agents-chg-file">
                      <button
                        type="button"
                        className="agents-chg-open"
                        title={f.path}
                        onClick={() => openDiff(api, project, f, false)}
                        onDoubleClick={() => openDiff(api, project, f, true)}
                      >
                        <span className={`agents-changes-code agents-changes-${f.group}`}>{codeOf(f)}</span>
                        <span className="agents-chg-path">{f.path}</span>
                      </button>
                      {group === 'staged' ? (
                        <button type="button" disabled={busy} title={t('panel.changes.unstage')} aria-label={t('panel.changes.unstage')} onClick={() => void run('unstage', { paths: [f.path] })}>
                          −
                        </button>
                      ) : (
                        <>
                          <button type="button" disabled={busy} title={t('panel.changes.stage')} aria-label={t('panel.changes.stage')} onClick={() => void run('stage', { paths: [f.path] })}>
                            +
                          </button>
                          <button type="button" disabled={busy} title={t('panel.changes.discard')} aria-label={t('panel.changes.discard')} onClick={() => void discard([f])}>
                            ×
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangesPanel({ project, api, visible }: PanelProps) {
  return (
    <div className="agents-panel-changes">
      <ChangesView project={project} api={api} visible={visible} />
    </div>
  );
}

function ChangesSection({ project, api }: SectionProps) {
  if (!project) return <p className="agents-empty agents-placeholder">{t('agents.panel.changes.empty')}</p>;
  return <ChangesView project={project} api={api} visible />;
}

export const panel: PanelModule = {
  kind: 'changes',
  titleKey: 'panel.changes.title',
  icon: 'git-branch',
  placement: 'both',
  addMenu: 'tools',
  single: true,
  Panel: ChangesPanel,
  Section: ChangesSection,
};
