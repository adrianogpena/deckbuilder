import { copyText, IconButton, type SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import type { Pod } from '../pods/model';
import type { Ticket } from './model';
import { jiraUrl } from './TicketCard';
import { TicketOverview } from './TicketOverview';
import type { TicketLink } from './types';

export interface TicketSideInput {
  instanceId: string;
  ticket: Ticket;
  link?: TicketLink;
  allPods: Pod[];
  config: Record<string, unknown> & { jiraBaseUrl: string };
  onChanged(): void;
}

/** What the Tickets panel opens in the Dashboard side panel for one ticket. */
export function ticketSideContent({ instanceId, ticket, link, allPods, config, onChanged }: TicketSideInput): SidePanelContent {
  const url = jiraUrl(config.jiraBaseUrl, ticket.key);
  return {
    id: `${instanceId}:${ticket.id}`,
    title: ticket.key,
    subtitle: ticket.status,
    icon: 'table',
    tabs: [
      {
        id: 'overview',
        label: tKey('dash.pods.tab.overview'),
        render: () => <TicketOverview ticket={ticket} link={link} allPods={allPods} config={config} onChanged={onChanged} />,
      },
    ],
    actions: (
      <>
        <IconButton icon="copy" label={tKey('dash.tickets.copyKey')} onClick={() => void copyText(ticket.key)} />
        {url && <IconButton icon="link" label={tKey('dash.tickets.openJira')} onClick={() => window.open(url, '_blank', 'noreferrer')} />}
      </>
    ),
  };
}
