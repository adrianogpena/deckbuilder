import { type CommandDef, explorerCommands, GLOBAL, paletteCommand, quickOpenCommand, tabCommands } from '@deckbuilder/ui';
import { t } from './i18n';
import { NAV } from './nav';

export const navCommandId = (screen: string) => `nav.${screen}`;
export const TOGGLE_NAV = 'app.toggleNav';

/** Every shortcut of the gallery; built at render so the labels follow the language. */
export function commands(): CommandDef[] {
  const nav = NAV.flatMap((s) => s.items).map((item, i): CommandDef => ({
    id: navCommandId(item.id), scope: GLOBAL, label: t(item.label), keys: [`Ctrl+${i + 1}`], inInput: true,
  }));
  return [
    paletteCommand(),
    quickOpenCommand(),
    ...nav,
    { id: TOGGLE_NAV, scope: GLOBAL, label: t('keys.toggleNav'), keys: ['Ctrl+Shift+B'], inInput: true },
    ...tabCommands('tabs'),
    ...tabCommands('explorer'),
    ...tabCommands('terminal'),
    ...explorerCommands('explorer'),
    { id: 'explorer.find', scope: 'explorer', label: t('keys.explorer.find'), keys: ['Ctrl+Alt+F'], inInput: true },
    { id: 'explorer.search', scope: 'explorer', label: t('keys.explorer.search'), keys: ['Ctrl+Shift+F'], inInput: true },
    { id: 'explorer.revealInTree', scope: 'explorer', label: t('keys.explorer.revealInTree'), keys: [] },
    { id: 'explorer.collapseAll', scope: 'explorer', label: t('keys.explorer.collapseAll'), keys: [] },
    { id: 'explorer.breadcrumbs', scope: 'explorer', label: t('keys.explorer.breadcrumbs'), keys: ['Ctrl+Shift+.', 'Ctrl+Shift+>'], inInput: true },
    // VS Code's Zen mode is Ctrl+K Z; the keymap has no two-key chords.
    { id: 'explorer.zen', scope: 'explorer', label: t('keys.explorer.zen'), keys: ['Ctrl+Alt+Z'], inInput: true },
    { id: 'explorer.file.save', scope: 'explorer', label: t('keys.file.save'), keys: ['Ctrl+S'], inInput: true },
    { id: 'explorer.file.wrap', scope: 'explorer', label: t('keys.file.wrap'), keys: ['Alt+Z'], inInput: true },
    // VS Code opens the preview to the side with Ctrl+K V; the keymap has no two-key chords.
    ...(['live', 'edit', 'split', 'preview'] as const).map((mode): CommandDef => ({
      id: `explorer.markdown.${mode}`, scope: 'explorer', label: t(`keys.markdown.${mode}`), inInput: true,
      keys: mode === 'preview' ? ['Ctrl+Shift+V'] : mode === 'split' ? ['Ctrl+Alt+V'] : [],
    })),
  ];
}

export function commandById(id: string): CommandDef {
  const def = commands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
