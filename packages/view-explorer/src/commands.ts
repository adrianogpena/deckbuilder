import { RICH_COMMAND_IDS, type RichCommandId } from '@deckbuilderkit/editor/markdown-commands';
import { type CommandDef, explorerCommands, tabCommands } from '@deckbuilderkit/ui';
import { t } from './i18n';

export function explorerViewCommands(): CommandDef[] {
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
    ...RICH_COMMAND_IDS.map((id): CommandDef => ({
      id: `explorer.markdown.${id}`, scope: 'explorer', label: t(`keys.markdown.${id}`), inInput: true, keys: MARKDOWN_KEYS[id] ?? [],
    })),
  ];
}

/**
 * Default keys of the markdown commands. Bold has none: Ctrl+B is the sidebar toggle of this view
 * (the editor's own Ctrl+B still bolds while typing).
 */
export const MARKDOWN_KEYS: Partial<Record<RichCommandId, string[]>> = {
  toggleSource: ['Ctrl+Shift+V'],
  italic: ['Ctrl+I'],
  strike: ['Ctrl+Shift+X'],
  paragraph: ['Ctrl+Alt+0'],
  h1: ['Ctrl+Alt+1'],
  h2: ['Ctrl+Alt+2'],
  h3: ['Ctrl+Alt+3'],
  bulletList: ['Ctrl+Shift+8'],
  numberedList: ['Ctrl+Shift+7'],
  toggleTask: ['Ctrl+Shift+9'],
  insertLink: ['Ctrl+Alt+K'],
  insertCodeBlock: ['Ctrl+Alt+C'],
  insertTable: ['Ctrl+Alt+T'],
  tableActions: ['Ctrl+Alt+Shift+T'],
  insertMermaid: ['Ctrl+Alt+M'],
  goToHeading: ['Ctrl+Shift+O'],
  insertFileLink: ['Ctrl+Alt+L'],
  zoomIn: ['Ctrl+Alt+='],
  zoomOut: ['Ctrl+Alt+-'],
};

export function explorerCommandById(id: string): CommandDef {
  const def = explorerViewCommands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
