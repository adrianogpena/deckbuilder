import { useState, type DragEvent, type MouseEvent } from 'react';
import { ContextMenu, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { AUTO_BADGE_MS } from './auto-move';
import type { Ticket } from './model';
import { TicketPipeline } from './Pipeline';
import type { TicketLink } from './types';

interface Props {
  ticket: Ticket;
  link?: TicketLink;
  jiraBaseUrl: string;
  onDescription(description: string): void;
  onDelete(): void;
  onAutoMove(value: boolean | null): void;
  onDetails(): void;
  onDragStart(e: DragEvent): void;
}

export const jiraUrl = (base: string, key: string): string => (base.trim() ? `${base.trim().replace(/\/+$/, '')}/browse/${key}` : '');

export function TicketCard({ ticket, link, jiraBaseUrl, onDescription, onDelete, onAutoMove, onDetails, onDragStart }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const url = jiraUrl(jiraBaseUrl, ticket.key);

  const save = () => {
    if (editing !== null && editing !== ticket.description) onDescription(editing);
    setEditing(null);
  };
  const open = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="tickets-card" draggable={editing === null} onDragStart={onDragStart} onContextMenu={open} onDoubleClick={onDetails}>
      <div className="tickets-card-head">
        <Icon name="grip" size={12} />
        {url ? (
          <a className="tickets-key" href={url} target="_blank" rel="noreferrer" title={url}>
            {ticket.key}
          </a>
        ) : (
          <span className="tickets-key">{ticket.key}</span>
        )}
        {ticket.autoMovedAt !== undefined && Date.now() - ticket.autoMovedAt < AUTO_BADGE_MS && (
          <span className="tickets-auto" title={tKey('dash.tickets.autoMove.badgeTitle')}>
            {tKey('dash.tickets.autoMove.badge')}
          </span>
        )}
      </div>
      {editing !== null ? (
        <textarea
          className="tickets-edit"
          autoFocus
          rows={3}
          value={editing}
          aria-label={tKey('dash.tickets.editDescription')}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(null);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={`tickets-desc${ticket.description ? '' : ' tickets-desc-empty'}`}
          onClick={() => setEditing(ticket.description)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setEditing(ticket.description);
          }}
        >
          {ticket.description || tKey('dash.tickets.noDescription')}
        </div>
      )}
      <TicketPipeline ticket={ticket} link={link} />
      {menu && (
        <ContextMenu
          at={menu}
          onClose={() => setMenu(null)}
          items={[
            { id: 'details', label: tKey('dash.tickets.details'), icon: 'file-text', run: onDetails },
            'sep',
            { id: 'am-default', label: tKey('dash.tickets.autoMove.default'), radio: true, checked: ticket.autoMove === null, run: () => onAutoMove(null) },
            { id: 'am-on', label: tKey('dash.tickets.autoMove.on'), radio: true, checked: ticket.autoMove === true, run: () => onAutoMove(true) },
            { id: 'am-off', label: tKey('dash.tickets.autoMove.off'), radio: true, checked: ticket.autoMove === false, run: () => onAutoMove(false) },
            'sep',
            { id: 'copy', label: tKey('dash.tickets.copyKey'), icon: 'copy', run: () => void navigator.clipboard.writeText(ticket.key) },
            { id: 'open', label: tKey('dash.tickets.openJira'), icon: 'link', disabled: !url, run: () => window.open(url, '_blank', 'noreferrer') },
            'sep',
            { id: 'delete', label: tKey('dash.tickets.delete'), icon: 'trash', danger: true, run: onDelete },
          ]}
        />
      )}
    </div>
  );
}
