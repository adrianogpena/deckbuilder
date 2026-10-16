import type { CommandDef } from '@deckbuilderkit/ui';
import { t } from './i18n';

export const workbenchCommands = (): CommandDef[] => [
  { id: 'workbench.format', scope: 'workbench', label: t('keys.workbench.format'), keys: ['Alt+Shift+F'], inInput: true },
  { id: 'workbench.explain', scope: 'workbench', label: t('keys.workbench.explain'), keys: ['Ctrl+E'], inInput: true },
  { id: 'workbench.problems', scope: 'workbench', label: t('keys.workbench.problems'), keys: ['Ctrl+Shift+M'], inInput: true },
];
