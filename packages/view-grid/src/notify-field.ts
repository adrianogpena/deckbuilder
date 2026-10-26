import type { PanelField } from '@kedalion/ui/grid';

/** The shared "Notify on changes" toggle of a panel; read it as `config.notify !== false`. */
export const notifyField = (defaultOn: boolean, legacyKeys?: readonly string[]): PanelField => ({
  key: 'notify',
  kind: 'boolean',
  label: 'dash.notify',
  default: defaultOn,
  ...(legacyKeys ? { legacyKeys } : {}),
});
