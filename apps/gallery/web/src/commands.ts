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
    { id: 'explorer.find', scope: 'explorer', label: t('keys.explorer.find'), keys: ['Ctrl+F'], inInput: true },
    { id: 'explorer.search', scope: 'explorer', label: t('keys.explorer.search'), keys: ['Ctrl+Shift+F'], inInput: true },
    { id: 'terminal.find', scope: 'terminal', label: t('keys.terminal.find'), keys: ['Ctrl+Shift+F'] },
    { id: 'terminal.prevCommand', scope: 'terminal', label: t('keys.terminal.prevCommand'), keys: ['Ctrl+ArrowUp'] },
    { id: 'terminal.nextCommand', scope: 'terminal', label: t('keys.terminal.nextCommand'), keys: ['Ctrl+ArrowDown'] },
    ...terminalCommands(),
    { id: 'explorer.revealInTree', scope: 'explorer', label: t('keys.explorer.revealInTree'), keys: ['Ctrl+K Ctrl+E'] },
    { id: 'explorer.collapseAll', scope: 'explorer', label: t('keys.explorer.collapseAll'), keys: ['Ctrl+K Ctrl+Shift+0'] },
    { id: 'explorer.breadcrumbs', scope: 'explorer', label: t('keys.explorer.breadcrumbs'), keys: ['Ctrl+Shift+.', 'Ctrl+Shift+>'], inInput: true },
    { id: 'explorer.zen', scope: 'explorer', label: t('keys.explorer.zen'), keys: ['Ctrl+K Z'], inInput: true },
    ...explorerCommands('git'),
    { id: 'git.refresh', scope: 'git', label: t('keys.git.refresh'), keys: [] },
    { id: 'git.nextChange', scope: 'git', label: t('keys.git.nextChange'), keys: ['F7'] },
    { id: 'git.prevChange', scope: 'git', label: t('keys.git.prevChange'), keys: ['Shift+F7'] },
    { id: 'workbench.format', scope: 'workbench', label: t('keys.workbench.format'), keys: ['Alt+Shift+F'], inInput: true },
    { id: 'workbench.explain', scope: 'workbench', label: t('keys.workbench.explain'), keys: ['Ctrl+E'], inInput: true },
    { id: 'workbench.problems', scope: 'workbench', label: t('keys.workbench.problems'), keys: ['Ctrl+Shift+M'], inInput: true },
    { id: 'explorer.sql.problems', scope: 'explorer', label: t('keys.explorer.sqlProblems'), keys: ['Ctrl+Shift+M'], inInput: true },
    { id: 'rest.save', scope: 'rest', label: t('keys.rest.save'), keys: ['Ctrl+S'], inInput: true },
    { id: 'explorer.file.save', scope: 'explorer', label: t('keys.file.save'), keys: ['Ctrl+S'], inInput: true },
    { id: 'explorer.file.wrap', scope: 'explorer', label: t('keys.file.wrap'), keys: ['Alt+Z'], inInput: true },
    { id: 'explorer.sql.format', scope: 'explorer', label: t('keys.explorer.sqlFormat'), keys: ['Alt+Shift+F'], inInput: true },
    ...(['live', 'edit', 'split', 'preview'] as const).map((mode): CommandDef => ({
      id: `explorer.markdown.${mode}`, scope: 'explorer', label: t(`keys.markdown.${mode}`), inInput: true,
      keys: mode === 'preview' ? ['Ctrl+Shift+V'] : mode === 'split' ? ['Ctrl+Alt+V'] : [],
    })),
  ];
}

const PANE_DIRS = ['Left', 'Right', 'Up', 'Down'] as const;
/** Terminal view commands the screen runs (panes, new tabs); they reach it while a terminal has focus. */
export const TERMINAL_SCREEN_COMMANDS = [
  ...PANE_DIRS.map((d) => `terminal.focus${d}`),
  ...PANE_DIRS.map((d) => `terminal.resize${d}`),
  'terminal.splitRight',
  'terminal.splitDown',
  ...Array.from({ length: 9 }, (_, i) => `terminal.newTabProfile${i + 1}`),
  'terminal.newTabMenu',
];

/** Terminal pane, zoom, scroll and new-tab commands (the pane ones mirror `PANE_COMMANDS` of the terminal package). */
function terminalCommands(): CommandDef[] {
  const def = (name: string, keys: string[], label = t(`keys.terminal.${name}` as Parameters<typeof t>[0])): CommandDef => ({
    id: `terminal.${name}`, scope: 'terminal', label, keys,
  });
  return [
    def('zoomIn', ['Ctrl+=', 'Ctrl++', 'Ctrl+Shift++']),
    def('zoomOut', ['Ctrl+-']),
    def('zoomReset', ['Ctrl+0']),
    def('scrollLineUp', ['Ctrl+Shift+ArrowUp']),
    def('scrollLineDown', ['Ctrl+Shift+ArrowDown']),
    def('scrollPageUp', ['Ctrl+Shift+PageUp']),
    def('scrollPageDown', ['Ctrl+Shift+PageDown']),
    def('scrollTop', ['Ctrl+Shift+Home']),
    def('scrollBottom', ['Ctrl+Shift+End']),
    def('clear', ['Ctrl+Shift+K']),
    ...PANE_DIRS.map((d) => def(`focus${d}`, [`Alt+Arrow${d}`])),
    ...PANE_DIRS.map((d) => def(`resize${d}`, [`Alt+Shift+Arrow${d}`])),
    def('splitRight', ['Alt+Shift++', 'Alt+Shift+=']),
    def('splitDown', ['Alt+Shift+_', 'Alt+Shift+-']),
    ...Array.from({ length: 9 }, (_, i) => def(`newTabProfile${i + 1}`, [`Ctrl+Shift+${i + 1}`], t('keys.terminal.newTabProfile', { n: i + 1 }))),
    def('newTabMenu', ['Ctrl+Shift+Space']),
  ];
}

/** Commands whose keys reach the app while a terminal in view `scope` has focus; the rest goes to the shell. */
export function terminalAppKeys(scope: string): CommandDef[] {
  const ids = new Set([
    'palette.toggle', KEYS_COMMAND, `${scope}.tab.saveAll`, `${scope}.pane.maximize`,
    ...(scope === 'explorer' ? ['explorer.zen'] : []),
    ...(scope === 'terminal' ? TERMINAL_SCREEN_COMMANDS : []),
  ]);
  return commands().filter((d) => ids.has(d.id));
}

export function commandById(id: string): CommandDef {
  const def = commands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
