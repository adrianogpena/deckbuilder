import { lazy } from 'react';
import { type CommandDef, defineView } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';

// The editor and its language parsers are a separate chunk, loaded on first visit.
const WorkbenchScreen = lazy(() => import('./WorkbenchScreen').then((m) => ({ default: m.WorkbenchScreen })));

const workbenchCommands = (): CommandDef[] => [
  { id: 'workbench.format', scope: 'workbench', label: t('keys.workbench.format'), keys: ['Alt+Shift+F'], inInput: true },
  { id: 'workbench.explain', scope: 'workbench', label: t('keys.workbench.explain'), keys: ['Ctrl+E'], inInput: true },
  { id: 'workbench.problems', scope: 'workbench', label: t('keys.workbench.problems'), keys: ['Ctrl+Shift+M'], inInput: true },
];

export const workbenchView = defineView<'workbench', Settings>({
  id: 'workbench',
  nav: { group: 'nav.section.main', icon: 'play', label: 'nav.workbench', order: 50 },
  render: ({ settings, onSave }) => <WorkbenchScreen settings={settings} onSave={onSave} />,
  commands: workbenchCommands,
  messages: { en: {}, 'pt-BR': {} },
});
