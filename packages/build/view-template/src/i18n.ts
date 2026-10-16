import { createT, type Messages } from '@deckbuilderkit/ui';

export const en = {
  'nav.__VIEW_ID__': '__VIEW_TITLE__',
  '__VIEW_CAMEL__.heading': '__VIEW_TITLE__',
};

export const ptBR: Messages<typeof en> = {
  'nav.__VIEW_ID__': '__VIEW_TITLE__',
  '__VIEW_CAMEL__.heading': '__VIEW_TITLE__',
};

export type __VIEW_NAME__MessageKey = keyof typeof en;
export const t = createT<__VIEW_NAME__MessageKey>();
