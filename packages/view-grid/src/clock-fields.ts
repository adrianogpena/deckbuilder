import type { PanelField, PanelKindSpec } from '@deckbuilderkit/ui/grid';

/** Config fields of the built-in `clock` kind (shared by the web panel and the server's validation). */
export const CLOCK_FIELDS: readonly PanelField[] = [
  { key: 'timeZone', kind: 'string', label: 'grid.clock.timeZone', description: 'grid.clock.timeZone.hint', placeholder: 'grid.clock.timeZone.placeholder', default: '', maxLength: 64 },
  { key: 'hour12', kind: 'boolean', label: 'grid.clock.hour12', description: 'grid.clock.hour12.hint', default: false },
  { key: 'showSeconds', kind: 'boolean', label: 'grid.clock.showSeconds', default: true },
  { key: 'showDate', kind: 'boolean', label: 'grid.clock.showDate', default: true },
  { key: 'layout', kind: 'enum', label: 'grid.clock.layout', default: 'digital', values: ['digital', 'analog'], optionLabel: 'grid.clock.layout' },
];

/** The server's view of the built-in `clock` kind, for `gridServerView({ panels })`. */
export const CLOCK_SPEC: PanelKindSpec & { kind: string } = { kind: 'clock', fields: CLOCK_FIELDS, allowMultiple: true };
