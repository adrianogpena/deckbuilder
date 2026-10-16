import type { CommandDef } from '@deckbuilderkit/ui';

/**
 * Of `all` (every command of the app), those whose keys reach the app while a terminal in view `scope`
 * has focus; the rest goes to the shell. `extra` adds command ids of the view.
 */
export function terminalAppKeys(scope: string, all: readonly CommandDef[], extra: readonly string[] = []): CommandDef[] {
  const ids = new Set(['palette.toggle', 'app.keybindings', `${scope}.tab.saveAll`, `${scope}.pane.maximize`, ...extra]);
  return all.filter((d) => ids.has(d.id));
}
