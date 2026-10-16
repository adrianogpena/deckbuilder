import { addMessages, createT } from '@deckbuilder/ui';
import type { TerminalMessageKey } from '@deckbuilder/view-terminal/web';
import { en } from './en';
import { ptBR } from './pt-BR';

// The views add their own messages in views.ts; terminal ones are typed here for the Settings modal.
addMessages({ en, 'pt-BR': ptBR });

export type MessageKey = keyof typeof en | TerminalMessageKey;
export const t = createT<MessageKey>();
