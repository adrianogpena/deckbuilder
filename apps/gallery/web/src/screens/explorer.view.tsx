import { type CommandDef, defineView, explorerCommands, tabCommands } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';
import { ExplorerScreen } from './ExplorerScreen';

function explorerViewCommands(): CommandDef[] {
  return [
    ...tabCommands('explorer'),
    ...explorerCommands('explorer'),
    { id: 'explorer.find', scope: 'explorer', label: t('keys.explorer.find'), keys: ['Ctrl+F'], inInput: true },
    { id: 'explorer.search', scope: 'explorer', label: t('keys.explorer.search'), keys: ['Ctrl+Shift+F'], inInput: true },
    { id: 'explorer.revealInTree', scope: 'explorer', label: t('keys.explorer.revealInTree'), keys: ['Ctrl+K Ctrl+E'] },
    { id: 'explorer.collapseAll', scope: 'explorer', label: t('keys.explorer.collapseAll'), keys: ['Ctrl+K Ctrl+Shift+0'] },
    { id: 'explorer.breadcrumbs', scope: 'explorer', label: t('keys.explorer.breadcrumbs'), keys: ['Ctrl+Shift+.', 'Ctrl+Shift+>'], inInput: true },
    { id: 'explorer.zen', scope: 'explorer', label: t('keys.explorer.zen'), keys: ['Ctrl+K Z'], inInput: true },
    { id: 'explorer.sql.problems', scope: 'explorer', label: t('keys.explorer.sqlProblems'), keys: ['Ctrl+Shift+M'], inInput: true },
    { id: 'explorer.file.save', scope: 'explorer', label: t('keys.file.save'), keys: ['Ctrl+S'], inInput: true },
    { id: 'explorer.file.wrap', scope: 'explorer', label: t('keys.file.wrap'), keys: ['Alt+Z'], inInput: true },
    { id: 'explorer.sql.format', scope: 'explorer', label: t('keys.explorer.sqlFormat'), keys: ['Alt+Shift+F'], inInput: true },
    ...(['live', 'edit', 'split', 'preview'] as const).map((mode): CommandDef => ({
      id: `explorer.markdown.${mode}`, scope: 'explorer', label: t(`keys.markdown.${mode}`), inInput: true,
      keys: mode === 'preview' ? ['Ctrl+Shift+V'] : mode === 'split' ? ['Ctrl+Alt+V'] : [],
    })),
  ];
}

export const explorerView = defineView<'explorer', Settings>({
  id: 'explorer',
  nav: { group: 'nav.section.main', icon: 'folder', label: 'nav.explorer', order: 40 },
  render: ({ settings, onSave }) => <ExplorerScreen settings={settings} onSave={onSave} />,
  commands: explorerViewCommands,
  messages: { en: {}, 'pt-BR': {} },
});
