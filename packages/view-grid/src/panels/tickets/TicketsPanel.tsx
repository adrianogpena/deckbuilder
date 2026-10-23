import { useState, type DragEvent } from 'react';
import { Icon } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { columns } from './model';
import { TicketCard } from './TicketCard';
import type { TicketsData } from './types';
import './tickets.css';

export interface TicketsConfig {
  statuses: string;
  keyPattern: string;
  jiraBaseUrl: string;
  [key: string]: unknown;
}

interface Props {
  config: TicketsConfig;
  data: TicketsData | undefined;
  refresh(): void;
}

export function TicketsPanel({ config, data, refresh }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState<{ status: string; index: number } | null>(null);

  if (!data) return null;

  const act = async (name: string, payload: unknown) => {
    try {
      await runAction('tickets', name, config, payload);
      setError('');
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
    refresh();
  };

  const add = async () => {
    const value = key.trim();
    if (!value) return;
    await act('add', { key: value });
    setKey('');
  };

  const dropIndex = (e: DragEvent<HTMLElement>, count: number): number => {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.tickets-card'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return i;
    }
    return count;
  };

  const cols = columns(data.tickets, data.statuses);

  return (
    <div className="tickets">
      <div className="tickets-bar">
        <Icon name="plus" size={14} />
        <input
          className="tickets-add"
          value={key}
          placeholder={tKey('dash.tickets.add')}
          aria-label={tKey('dash.tickets.add')}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        {error && <span className="tickets-error">{error}</span>}
      </div>
      <div className="tickets-board">
        {cols.map((col) => (
          <section
            key={col.status}
            className={`tickets-col${over?.status === col.status ? ' tickets-col-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver({ status: col.status, index: dropIndex(e, col.tickets.length) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const index = dropIndex(e, col.tickets.length);
              setOver(null);
              if (id) void act('move', { id, status: col.status, index });
            }}
          >
            <h4 className="tickets-col-head">
              <span>{col.status}</span>
              <span className="tickets-count">{col.tickets.length}</span>
            </h4>
            <div className="tickets-cards">
              {col.tickets.length === 0 && <p className="kit-empty">{tKey('dash.tickets.empty')}</p>}
              {col.tickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  link={data.links?.[t.key]}
                  jiraBaseUrl={config.jiraBaseUrl}
                  onDescription={(description) => void act('update', { id: t.id, description })}
                  onDelete={() => void act('remove', { id: t.id })}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
