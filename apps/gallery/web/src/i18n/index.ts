import { sqlEn, sqlPtBR } from '@deckbuilder/sql-ui';
import { addMessages, createT } from '@deckbuilder/ui';
import type { GitMessageKey } from '@deckbuilder/view-git/web';
import type { RestMessageKey } from '@deckbuilder/view-rest/web';
import type { TerminalMessageKey } from '@deckbuilder/view-terminal/web';
import type { WorkbenchMessageKey } from '@deckbuilder/view-workbench/web';
import { en } from './en';
import { ptBR } from './pt-BR';

// The views add their own messages in views.ts; terminal ones are typed here for the Settings modal.
addMessages({ en, 'pt-BR': ptBR });
addMessages({ en: sqlEn, 'pt-BR': sqlPtBR });

export type MessageKey = keyof typeof en | TerminalMessageKey | WorkbenchMessageKey | RestMessageKey | GitMessageKey;
export const t = createT<MessageKey>();
