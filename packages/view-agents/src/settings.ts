import { bool, groupField, num, oneOf, type SettingDef } from '@deckbuilderkit/ui';
import type { AgentsMode, AgentsSettings } from './settings-types';

export type { AgentsMode, AgentsSettings };

const AGENTS_MODES: readonly AgentsMode[] = ['terminal', 'chat'];

/** The part of the app settings the Agents view reads; the app's `Settings` extends it. */
export interface AgentsViewSettings {
  agents?: AgentsSettings;
}

export const agentsSettingDefs: SettingDef<AgentsViewSettings>[] = [
  groupField<AgentsViewSettings, 'agents'>('agents', 'mode', 10, oneOf('terminal', AGENTS_MODES)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'softCap', 20, num(12, 1, 100)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'autoSettle', 25, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyNeedsYou', 30, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyDone', 40, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyError', 50, bool(true)),
];
