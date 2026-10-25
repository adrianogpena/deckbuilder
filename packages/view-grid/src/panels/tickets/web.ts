import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { TICKETS_FIELDS } from './fields';
import { TicketsActions } from './TicketsActions';
import { TicketsPanel, type TicketsConfig } from './TicketsPanel';
import type { TicketsData } from './types';

const ticketsPanel = definePanel<TicketsConfig, TicketsData>({
  kind: 'tickets',
  title: 'dash.tickets.panel',
  description: 'dash.tickets.panel.description',
  icon: 'table',
  category: 'dash.category.tickets',
  size: { w: 16, h: 12, minW: 6, minH: 5 },
  config: { fields: TICKETS_FIELDS },
  load: (config) => fetchSource<TicketsData>('tickets', config),
  refreshMs: () => 60_000,
  allowMultiple: false,
  headerActions: TicketsActions,
  render: ({ id, config, data, refresh, side }) => createElement(TicketsPanel, { id, side, config, data, refresh }),
});

export const panels: AnyPanelKind[] = [ticketsPanel];
