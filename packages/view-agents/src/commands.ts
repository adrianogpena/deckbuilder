import type { CommandDef } from '@deckbuilderkit/ui';
import { t } from './i18n';

export const agentsCommands = (): CommandDef[] => [
  { id: 'agents.toggleSidebar', scope: 'agents', label: t('keys.agents.toggleSidebar'), keys: [] },
  { id: 'agents.togglePanel', scope: 'agents', label: t('keys.agents.togglePanel'), keys: [] },
  { id: 'agents.nextWaiting', scope: 'agents', label: t('keys.agents.nextWaiting'), keys: ['Ctrl+Shift+J'] },
  { id: 'agents.alerts', scope: 'agents', label: t('keys.agents.alerts'), keys: [] },
  { id: 'agents.copyResponse', scope: 'agents', label: t('keys.agents.copyResponse'), keys: [] },
  { id: 'agents.clearContext', scope: 'agents', label: t('keys.agents.clearContext'), keys: ['Ctrl+L'] },
  { id: 'agents.clearFilters', scope: 'agents', label: t('keys.agents.clearFilters'), keys: [] },
  { id: 'agents.cycleSort', scope: 'agents', label: t('keys.agents.cycleSort'), keys: [] },
  { id: 'agents.previousSession', scope: 'agents', label: t('keys.agents.previousSession'), keys: [] },
  { id: 'agents.prevStarted', scope: 'agents', label: t('keys.agents.prevStarted'), keys: [] },
  { id: 'agents.nextStarted', scope: 'agents', label: t('keys.agents.nextStarted'), keys: [] },
  { id: 'agents.batchStop', scope: 'agents', label: t('keys.agents.batchStop'), keys: [] },
  { id: 'agents.batchTags', scope: 'agents', label: t('keys.agents.batchTags'), keys: [] },
  { id: 'agents.batchMove', scope: 'agents', label: t('keys.agents.batchMove'), keys: [] },
  { id: 'agents.batchClear', scope: 'agents', label: t('keys.agents.batchClear'), keys: [] },
  { id: 'agents.archive', scope: 'agents', label: t('keys.agents.archive'), keys: [] },
  { id: 'agents.toggleArchived', scope: 'agents', label: t('keys.agents.toggleArchived'), keys: [] },
  { id: 'agents.delete', scope: 'agents', label: t('keys.agents.delete'), keys: [] },
  { id: 'agents.undoDelete', scope: 'agents', label: t('keys.agents.undoDelete'), keys: [] },
  { id: 'agents.openTrash', scope: 'agents', label: t('keys.agents.openTrash'), keys: [] },
];
