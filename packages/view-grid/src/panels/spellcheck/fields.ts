import type { PanelField } from '@kedalion/ui/grid';
import { DEFAULT_SERVER } from './model';

export const SPELLCHECK_FIELDS: readonly PanelField[] = [
  { key: 'server', kind: 'string', label: 'dash.spell.server', description: 'dash.spell.server.hint', placeholder: 'dash.spell.server.placeholder', default: DEFAULT_SERVER, maxLength: 200 },
  { key: 'languages', kind: 'text', label: 'dash.spell.languages', description: 'dash.spell.languages.hint', placeholder: 'dash.spell.languages.placeholder', default: '', maxLength: 1000, rows: 4 },
];

/** Config field lists of the spellcheck panel (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = { spellcheck: SPELLCHECK_FIELDS };
