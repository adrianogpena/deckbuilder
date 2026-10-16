import { lazy } from 'react';
import { type CommandDef, defineView, explorerCommands } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';
import { gitSettingsOf } from '../settings';

const GitScreen = lazy(() => import('./GitScreen').then((m) => ({ default: m.GitScreen })));

const gitCommands = (): CommandDef[] => [
  ...explorerCommands('git'),
  { id: 'git.refresh', scope: 'git', label: t('keys.git.refresh'), keys: [] },
  { id: 'git.nextChange', scope: 'git', label: t('keys.git.nextChange'), keys: ['F7'] },
  { id: 'git.prevChange', scope: 'git', label: t('keys.git.prevChange'), keys: ['Shift+F7'] },
];

export const gitView = defineView<'git', Settings>({
  id: 'git',
  nav: { group: 'nav.section.main', icon: 'git-branch', label: 'nav.git', order: 80 },
  render: ({ settings, onSave }) => <GitScreen settings={settings} onSave={onSave} initialDiffMode={gitSettingsOf(settings).diffMode} />,
  commands: gitCommands,
  messages: { en: {}, 'pt-BR': {} },
});
