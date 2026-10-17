import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiError, Empty, ErrorBanner, errorOf, Modal, Spinner, useRovingList } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentTrashEntry } from '../protocol.ts';
import { listTrash, restoreTrashed, trashMessage } from './api';

/** Compact age of a trash entry: 45s, 12m, 3h, 2d. */
export function trashAge(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export interface TrashPanelProps {
  /** A restore succeeded: the caller selects the session and flashes. */
  onRestored(id: string, title: string): void;
  /** A restore was refused: the server's message. */
  onRefused(message: string): void;
  onClose(): void;
}

/** Trash picker: deleted sessions newest first; Enter restores, Escape closes. */
export function TrashPanel({ onRestored, onRefused, onClose }: TrashPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<AgentTrashEntry[]>();
  const [error, setError] = useState<ApiError>();
  const load = useCallback(() => {
    setError(undefined);
    setEntries(undefined);
    listTrash()
      .then((list) => setEntries([...list].sort((a, b) => b.trashedAt - a.trashedAt)))
      .catch((e) => setError(errorOf(e)));
  }, []);
  useEffect(load, [load]);
  useRovingList(ref, '.agents-pick');

  const restore = async (e: AgentTrashEntry) => {
    try {
      const r = await restoreTrashed(e.id);
      if (!r.ok) return onRefused(trashMessage(r.error));
      onClose();
      onRestored(r.id, r.title || e.title || e.id);
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const now = Date.now();
  return (
    <Modal title={t('agents.trash.title')} onClose={onClose}>
      {error && <ErrorBanner error={error} onRetry={load} compact />}
      {!entries && !error && <Spinner />}
      {entries && entries.length === 0 && <Empty title={t('agents.trash.empty')} />}
      <div className="agents-pick-list" ref={ref} role="group" aria-label={t('agents.trash.title')}>
        {entries?.map((e, i) => {
            const title = e.title || e.id;
            const age = trashAge(e.trashedAt, now);
            const label = t('agents.trash.row', { title, age });
            return (
              <button key={e.id} type="button" className="agents-pick agents-trash-row" title={label} aria-label={label} autoFocus={i === 0} onClick={() => void restore(e)}>
                <span className="agents-trash-title">{title}</span>
                <span className="agents-trash-age">{age}</span>
              </button>
            );
          })}
      </div>
    </Modal>
  );
}
