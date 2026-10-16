import { sqlEn, sqlPtBR } from '@deckbuilderkit/sql-ui';
import { addMessages, createT } from '@deckbuilderkit/ui';
import type { ExplorerMessageKey } from '@deckbuilderkit/view-explorer/web';
import type { GitMessageKey } from '@deckbuilderkit/view-git/web';
import type { RestMessageKey } from '@deckbuilderkit/view-rest/web';
import type { TerminalMessageKey } from '@deckbuilderkit/view-terminal/web';
import type { WorkbenchMessageKey } from '@deckbuilderkit/view-workbench/web';
import { en } from './en';
import { ptBR } from './pt-BR';

// The views add their own messages in views.ts; terminal ones are typed here for the Settings modal.
addMessages({ en, 'pt-BR': ptBR });
addMessages({ en: sqlEn, 'pt-BR': sqlPtBR });

export type MessageKey = keyof typeof en | TerminalMessageKey | WorkbenchMessageKey | RestMessageKey | GitMessageKey | ExplorerMessageKey;
export const t = createT<MessageKey>();
