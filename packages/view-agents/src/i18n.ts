import { createT, type Messages } from '@deckbuilderkit/ui';

export const en = {
  'nav.agents': 'Agents',
  'agents.heading': 'Agents',
};

export const ptBR: Messages<typeof en> = {
  'nav.agents': 'Agents',
  'agents.heading': 'Agents',
};

export type AgentsMessageKey = keyof typeof en;
export const t = createT<AgentsMessageKey>();
