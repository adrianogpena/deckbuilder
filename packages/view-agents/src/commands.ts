import type { CommandDef } from '@deckbuilderkit/ui';
import { t } from './i18n';

export const agentsCommands = (): CommandDef[] => [
  { id: 'agents.toggleSidebar', scope: 'agents', label: t('keys.agents.toggleSidebar'), keys: [] },
];
