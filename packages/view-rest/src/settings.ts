import type { HttpRequestDraft } from '@deckbuilder/editor';
import type { SectionPath, SettingDef } from '@deckbuilder/ui';

/** The stored REST screen state. */
export interface RestSettings {
  sizes?: { main: [number, number] };
  /** Id of the active REST environment; '' or absent = none. */
  environment?: string;
  /** Entries kept in the REST request history; 0 turns history off. */
  historySize?: number;
}

/** The part of the app settings the REST view reads and writes; the app's `Settings` extends it. */
export interface RestViewSettings {
  /** State of the REST screen; the server validates it. */
  rest?: RestSettings;
}

export interface SavedRequest {
  id: string;
  name: string;
  request: HttpRequestDraft;
  auth?: { hasSecret: true };
}

export interface RestTabsFile {
  version: 1;
  tabs: Array<{ id: string; draft: HttpRequestDraft; savedId?: string; title?: string }>;
  active?: string;
}

const rest: SectionPath = ['rest'];

export const restSettingDefs: SettingDef<RestViewSettings>[] = [
  {
    id: 'rest.historySize',
    kind: 'number',
    section: rest,
    order: 10,
    label: 'settings.rest.historySize',
    description: 'settings.rest.historySize.hint',
    default: 100,
    min: 0,
    max: 5000,
    get: (s) => s.rest?.historySize ?? 100,
    set: (s, historySize) => ({ rest: { ...s.rest, historySize } }),
  },
];
