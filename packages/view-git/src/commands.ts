import { type CommandDef, explorerCommands } from '@kedalion/ui';
import { t } from './i18n';

export const gitCommands = (): CommandDef[] => [
  ...explorerCommands('git'),
  { id: 'git.refresh', scope: 'git', label: t('keys.git.refresh'), keys: [] },
  { id: 'git.nextChange', scope: 'git', label: t('keys.git.nextChange'), keys: ['F7'] },
  { id: 'git.prevChange', scope: 'git', label: t('keys.git.prevChange'), keys: ['Shift+F7'] },
];
