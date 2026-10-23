import type { Ticket } from './model';

/** What the links step knows about a ticket: filled in by the pipeline strip. */
export interface TicketLink {
  stages?: unknown[];
  prs?: unknown[];
  pods?: unknown[];
  hours?: number;
}

export interface TicketsData {
  statuses: string[];
  tickets: Ticket[];
  links?: Record<string, TicketLink>;
}
