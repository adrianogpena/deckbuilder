import { useRef, useState } from 'react';
import { Button, dialogs, ErrorBanner, errorOf, Modal, Spinner, useAsync, useRovingList } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import { addAgentProject, type AgentProject, listProjectSuggestions } from './api';

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Dialog adding a project: the Explorer's projects as quick adds, or any folder through the folder picker. */
export function AddProject({ added, onAdded, onClose }: { added: AgentProject[]; onAdded(p: AgentProject): void; onClose(): void }) {
  const suggestions = useAsync(listProjectSuggestions, []);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useRovingList(list, '.agents-add-item');

  const quick = (suggestions.data ?? []).filter((p) => !added.some((a) => norm(a.path) === norm(p.path)));

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
      const picked = await dialogs.pickFolder({ title: t('agents.add.pick'), purpose: 'project' });
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
          <Button title={t('agents.new.cancel')} onClick={onClose}>{t('agents.new.cancel')}</Button>
          <Button variant="primary" title={t('agents.add.confirm')} disabled={!path} onClick={() => void add({ name: name.trim() || undefined, path })}>{t('agents.add.confirm')}</Button>
        </>
      }
    >
      <div className="agents-add">
        <h4>{t('agents.add.explorer')}</h4>
        {suggestions.error ? (
          <ErrorBanner error={suggestions.error} onRetry={suggestions.reload} compact />
        ) : suggestions.loading && !suggestions.data ? (
          <div className="agents-add-loading"><Spinner small /></div>
        ) : quick.length === 0 ? (
          <p className="agents-add-empty">{t('agents.add.noSuggestions')}</p>
        ) : (
          <div ref={list} className="agents-add-list" role="list" aria-label={t('agents.add.explorer')}>
            {quick.map((p) => (
              <button key={p.path} type="button" role="listitem" className="agents-add-item" title={`${p.name}\n${p.path}`} onClick={() => void add({ name: p.name, path: p.path })}>
                <span className="agents-add-item-name">{p.name}</span>
                <span className="agents-add-item-path">{p.path}</span>
              </button>
            ))}
          </div>
        )}
        <h4>{t('agents.add.folder')}</h4>
        <div className="agents-add-folder">
          <input readOnly value={path} placeholder={t('agents.add.noFolder')} aria-label={t('agents.add.folder')} />
          <Button size="sm" icon="folder" title={t('agents.add.browse')} onClick={() => void browse()}>{t('agents.add.browse')}</Button>
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
