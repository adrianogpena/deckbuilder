import { useState } from 'react';
import { Button, Icon } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import type { UnlinkedKey } from './types';

/** Keys carried by PRs or pods that have no card; keys only seen through review-requested PRs are left out. */
export const visibleUnlinked = (list: readonly UnlinkedKey[]): UnlinkedKey[] =>
  list.filter((u) => u.pods.length > 0 || u.prs.some((p) => p.scope !== 'review'));

export function UnlinkedList({ unlinked, onAdd }: { unlinked: readonly UnlinkedKey[]; onAdd(key: string): void }) {
  const [open, setOpen] = useState(true);
  const list = visibleUnlinked(unlinked);
  if (!list.length) return null;
  return (
    <section className="tickets-unlinked">
      <Button variant="ghost" size="xs" className="tickets-unlinked-head" icon={open ? 'chevron-down' : 'chevron'} aria-expanded={open} aria-label={tKey('dash.tickets.unlinked.toggle')} onClick={() => setOpen(!open)}>
        {tKey('dash.tickets.unlinked.title', { count: list.length })}
      </Button>
      {open &&
        list.map((u) => (
          <div key={u.key} className="tickets-unlinked-row">
            <strong>{u.key}</strong>
            <span className="tickets-unlinked-names">{[...u.prs.map((p) => p.title), ...u.pods.map((p) => p.name)].join(' · ')}</span>
            <Button onClick={() => onAdd(u.key)}>
              <Icon name="plus" size={12} /> {tKey('dash.tickets.unlinked.add')}
            </Button>
          </div>
        ))}
    </section>
  );
}
