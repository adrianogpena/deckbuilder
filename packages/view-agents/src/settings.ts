import { bool, groupField, num, oneOf, str, type SettingDef } from '@deckbuilderkit/ui';
import type { AgentsMode, AgentsSettings } from './settings-types';

export type { AgentsMode, AgentsSettings };

const AGENTS_MODES: readonly AgentsMode[] = ['terminal', 'chat'];

/** The part of the app settings the Agents view reads; the app's `Settings` extends it. */
export interface AgentsViewSettings {
  agents?: AgentsSettings;
}

/** Splits an argument line on whitespace; double quotes group words. */
export function parseArgs(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(S+)/g)) out.push(m[1] ?? m[2]!);
  return out;
}

export const formatArgs = (args: readonly string[]): string => args.map((a) => (a === '' || /s/.test(a) ? `"${a}"` : a)).join(' ');

const claudeArgsDef: SettingDef<AgentsViewSettings> = {
  id: 'agents.claudeArgs',
  section: ['agents'],
  order: 70,
  label: 'settings.agents.claudeArgs',
  description: 'settings.agents.claudeArgs.hint',
  kind: 'string',
  default: '',
  get: (s) => formatArgs(s.agents?.claudeArgs ?? []),
  set: (s, v) => ({ agents: { ...s.agents, claudeArgs: parseArgs(v) } }),
};

export const agentsSettingDefs: SettingDef<AgentsViewSettings>[] = [
  groupField<AgentsViewSettings, 'agents'>('agents', 'mode', 10, oneOf('terminal', AGENTS_MODES)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'softCap', 20, num(12, 1, 100)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'autoSettle', 25, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyNeedsYou', 30, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyDone', 40, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyError', 50, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'claudeCommand', 60, str('')),
  claudeArgsDef,
];
