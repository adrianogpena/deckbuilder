import { type CommandDef, explorerCommands, GLOBAL, paletteCommand, tabCommands } from '@deckbuilder/ui';
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
    ...nav,
    { id: TOGGLE_NAV, scope: GLOBAL, label: t('keys.toggleNav'), keys: ['Ctrl+Shift+B'], inInput: true },
    ...tabCommands('tabs'),
    ...tabCommands('explorer'),
    ...tabCommands('terminal'),
    ...explorerCommands('explorer'),
    { id: 'explorer.search', scope: 'explorer', label: t('keys.explorer.search'), keys: ['Ctrl+Shift+F'], inInput: true },
    { id: 'explorer.file.save', scope: 'explorer', label: t('keys.file.save'), keys: ['Ctrl+S'], inInput: true },
  ];
}

export function commandById(id: string): CommandDef {
  const def = commands().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown command ${id}`);
  return def;
}
