import { useEffect, useState } from 'react';
import { dialogs, errorOf, Modal } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { addAgentProject, type AgentProject, listExplorerProjects } from './api';

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Dialog adding a project: the Explorer's projects as quick adds, or any folder through the folder picker. */
export function AddProject({ added, onAdded, onClose }: { added: AgentProject[]; onAdded(p: AgentProject): void; onClose(): void }) {
  const [explorer, setExplorer] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void listExplorerProjects().then(setExplorer, () => undefined);
  }, []);

  const quick = explorer.filter((p) => !added.some((a) => norm(a.path) === norm(p.path)));

  const add = async (input: { name?: string; path: string }) => {
    setError('');
    try {
      const r = await addAgentProject(input);
      if (!r.ok || !r.project) throw new Error(t('agents.add.failed'));
      onAdded(r.project);
      onClose();
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  const browse = async () => {
    try {
      const picked = await dialogs.pickFolder({ title: t('agents.add.pick') });
      if (!picked) return;
      setPath(picked);
      setName(baseName(picked));
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  return (
    <Modal
      title={t('agents.add.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>{t('agents.new.cancel')}</button>
          <button type="button" disabled={!path} onClick={() => void add({ name: name.trim() || undefined, path })}>{t('agents.add.confirm')}</button>
        </>
      }
    >
      <div className="agents-add">
        {quick.length > 0 && (
          <>
            <h4>{t('agents.add.explorer')}</h4>
            <div className="agents-add-list">
              {quick.map((p) => (
                <button key={p.id} type="button" className="agents-add-item" title={p.path} onClick={() => void add({ name: p.name, path: p.path })}>
                  <strong>{p.name}</strong> <span>{p.path}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <h4>{t('agents.add.folder')}</h4>
        <div className="agents-add-folder">
          <input readOnly value={path} placeholder={t('agents.add.noFolder')} aria-label={t('agents.add.folder')} />
          <button type="button" onClick={() => void browse()}>{t('agents.add.browse')}</button>
        </div>
        <label>
          {t('agents.add.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <div role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
