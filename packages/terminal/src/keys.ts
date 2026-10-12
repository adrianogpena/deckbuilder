import { chordOf, type KeyLike } from '@deckbuilder/ui/keybindings';

/** What a key pressed inside the terminal does. */
export type TerminalKeyAction = 'app' | 'copy' | 'paste' | 'terminal';

/**
 * Keys go to the program, except chords of the allowed app commands, Ctrl+C / Ctrl+Shift+C with
 * text selected (copy), and Ctrl+V / Ctrl+Shift+V (paste).
 */
export function terminalKeyAction(e: KeyLike, hasSelection: boolean, appChords: ReadonlySet<string>): TerminalKeyAction {
  const chord = chordOf(e);
  if (!chord) return 'terminal';
  if (appChords.has(chord)) return 'app';
  if ((chord === 'Ctrl+C' || chord === 'Ctrl+Shift+C') && hasSelection) return 'copy';
  if (chord === 'Ctrl+V' || chord === 'Ctrl+Shift+V') return 'paste';
  return 'terminal';
}
