import { type CommandDef, explorerCommands, GLOBAL, paletteCommand, quickOpenCommand, tabCommands } from '@deckbuilder/ui';
import { t } from './i18n';
import { NAV } from './nav';

export const navCommandId = (screen: string) => `nav.${screen}`;
export const SETTINGS_COMMAND = 'app.settings';
export const KEYS_COMMAND = 'app.keybindings';

/** Every shortcut of the gallery; built at render so the labels follow the language. */
export function commands(): CommandDef[] {
  const nav = NAV.flatMap((s) => s.items).map((item, i): CommandDef => ({
    id: navCommandId(item.id), scope: GLOBAL, label: t(item.label), keys: [`Ctrl+${i + 1}`], inInput: true,
  }));
  return [
    paletteCommand(),
    quickOpenCommand(),
    ...nav,
    // Settings and keybindings are modals over the screen, not screens; both are VS Code's keys.
    { id: SETTINGS_COMMAND, scope: GLOBAL, label: t('nav.settings'), keys: ['Ctrl+,'], inInput: true },
    { id: KEYS_COMMAND, scope: GLOBAL, label: t('nav.keys'), keys: ['Ctrl+K Ctrl+S'], inInput: true },
    ...tabCommands('tabs'),
    ...tabCommands('explorer'),
    ...tabCommands('terminal'),
    ...explorerCommands('explorer'),
    { id: 'explorer.find', scope: 'explorer', label: t('keys.explorer.find'), keys: ['Ctrl+Alt+F'], inInput: true },
    { id: 'explorer.search', scope: 'explorer', label: t('keys.explorer.search'), keys: ['Ctrl+Shift+F'], inInput: true },
    { id: 'explorer.revealInTree', scope: 'explorer', label: t('keys.explorer.revealInTree'), keys: ['Ctrl+K Ctrl+E'] },
    { id: 'explorer.collapseAll', scope: 'explorer', label: t('keys.explorer.collapseAll'), keys: ['Ctrl+K Ctrl+Shift+0'] },
    { id: 'explorer.breadcrumbs', scope: 'explorer', label: t('keys.explorer.breadcrumbs'), keys: ['Ctrl+Shift+.', 'Ctrl+Shift+>'], inInput: true },
    { id: 'explorer.zen', scope: 'explorer', label: t('keys.explorer.zen'), keys: ['Ctrl+K Z'], inInput: true },
    { id: 'workbench.format', scope: 'workbench', label: t('keys.workbench.format'), keys: ['Alt+Shift+F'], inInput: true },
    { id: 'explorer.file.save', scope: 'explorer', label: t('keys.file.save'), keys: ['Ctrl+S'], inInput: true },
    { id: 'explorer.file.wrap', scope: 'explorer', label: t('keys.file.wrap'), keys: ['Alt+Z'], inInput: true },
    { id: 'explorer.sql.format', scope: 'explorer', label: t('keys.explorer.sqlFormat'), keys: ['Alt+Shift+F'], inInput: true },
    ...(['live', 'edit', 'split', 'preview'] as const).map((mode): CommandDef => ({
      id: `explorer.markdown.${mode}`, scope: 'explorer', label: t(`keys.markdown.${mode}`), inInput: true,
      keys: mode === 'preview' ? ['Ctrl+Shift+V'] : mode === 'split' ? ['Ctrl+Alt+V'] : [],
    })),
  ];
}

/** Commands whose keys reach the app while a terminal in view `scope` has focus; the rest goes to the shell. */
export function terminalAppKeys(scope: string): CommandDef[] {
  const ids = new Set(['palette.toggle', KEYS_COMMAND, `${scope}.tab.saveAll`, `${scope}.pane.maximize`, ...(scope === 'explorer' ? ['explorer.zen'] : [])]);
  return commands().filter((d) => ids.has(d.id));
}

export function commandById(id: string): CommandDef {
  const def = commands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
