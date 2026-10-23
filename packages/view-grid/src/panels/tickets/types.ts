import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import type { Ticket } from './model';

export type Stage = 'none' | 'ok' | 'pending' | 'warn' | 'fail';

/** What the linker knows about a ticket: its branch, PRs, pods and hours this week. */
export interface TicketLink {
  stages: { branch: Stage; pr: Stage; pods: Stage; hours: Stage };
  branches: string[];
  prs: TrackedPr[];
  pods: Pod[];
  hours: number | null;
}

/** A key found in PRs or pods that is not on the board. */
export interface UnlinkedKey {
  key: string;
  scopes: string[];
  prs: TrackedPr[];
  pods: Pod[];
}

export interface TicketsData {
  statuses: string[];
  tickets: Ticket[];
  links?: Record<string, TicketLink>;
  unlinked?: UnlinkedKey[];
  /** The PR fetch failed: links carry no PRs. */
  prError?: boolean;
}
