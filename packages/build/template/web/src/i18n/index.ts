import { addMessages, createT } from '@deckbuilder/ui';
import { en } from './en';
import { ptBR } from './pt-BR';

addMessages({ en, 'pt-BR': ptBR });

export type MessageKey = keyof typeof en;
export const t = createT<MessageKey>();
