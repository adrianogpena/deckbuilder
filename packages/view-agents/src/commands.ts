import type { CommandDef } from '@deckbuilderkit/ui';
import { t } from './i18n';

export const agentsCommands = (): CommandDef[] => [
  { id: 'agents.toggleSidebar', scope: 'agents', label: t('keys.agents.toggleSidebar'), keys: [] },
  { id: 'agents.togglePanel', scope: 'agents', label: t('keys.agents.togglePanel'), keys: [] },
  { id: 'agents.nextWaiting', scope: 'agents', label: t('keys.agents.nextWaiting'), keys: ['Ctrl+Shift+J'] },
];
