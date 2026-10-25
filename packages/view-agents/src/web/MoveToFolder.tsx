import { useRef } from 'react';
import { Modal, useRovingList } from '@kedalion/ui';
import { t } from '../i18n';

/** What the picker returns: the top level, a folder id, or a new folder. */
export type FolderPick = { to: 'top' } | { to: 'folder'; id: string } | { to: 'new' };

export interface MoveToFolderProps {
  /** The project being moved (in the title). */
  name: string;
  /** Replaces the default 'Move "name" to' title (batch moves). */
  title?: string;
  folders: Array<{ id: string; name: string }>;
  /** The project's current folder; the cursor starts on it (else on Top level). */
  current?: string;
  onPick(pick: FolderPick): void;
  onClose(): void;
}

/** Move to folder picker: Top level, each folder in order, then + New folder…. */
export function MoveToFolder({ name, title, folders, current, onPick, onClose }: MoveToFolderProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingList(ref, '.agents-pick');
  const item = (key: string, label: string, pick: FolderPick, on: boolean) => (
    <button key={key} type="button" className={`agents-pick${on ? ' current' : ''}`} title={label} autoFocus={on} aria-current={on ? 'true' : undefined} onClick={() => onPick(pick)}>
      {label}
    </button>
  );
  return (
    <Modal title={title ?? t('agents.folder.moveTitle', { name })} onClose={onClose}>
      <div className="agents-pick-list" ref={ref} role="group" aria-label={t('agents.folder.move')}>
        {item('top', t('agents.folder.topLevel'), { to: 'top' }, current === undefined)}
        {folders.map((f) => item(f.id, f.name, { to: 'folder', id: f.id }, f.id === current))}
        {item('new', t('agents.folder.newItem'), { to: 'new' }, false)}
      </div>
    </Modal>
  );
}
