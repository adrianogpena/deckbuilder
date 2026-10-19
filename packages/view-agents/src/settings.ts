import { bool, groupField, num, oneOf, str, type SettingDef } from '@deckbuilderkit/ui';
import type { AgentsRestore, AgentsSettings, AgentsUsagePosition } from './settings-types';

export type { AgentsRestore, AgentsSettings, AgentsUsagePosition };

export const RESTORE_MODES: readonly AgentsRestore[] = ['ask', 'always', 'never'];
export const USAGE_POSITIONS: readonly AgentsUsagePosition[] = ['top', 'bottom'];

/** The part of the app settings the Agents view reads; the app's `Settings` extends it. */
export interface AgentsViewSettings {
  agents?: AgentsSettings;
}

/** Splits an argument line on whitespace; double quotes group words. */
export function parseArgs(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]!);
  return out;
}

export const formatArgs = (args: readonly string[]): string => args.map((a) => (a === '' || /\s/.test(a) ? `"${a}"` : a)).join(' ');

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
  groupField<AgentsViewSettings, 'agents'>('agents', 'restoreSessions', 12, oneOf('ask', RESTORE_MODES)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'softCap', 20, num(12, 1, 100)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'resumeOnSelect', 15, bool(false)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'maxSessionsPerProject', 17, num(10, 1, 10000)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'trashRetentionDays', 18, num(30, 1, 3650)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'autoSettle', 25, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'gitStatus', 27, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'rightSidebarOpen', 27.5, bool(false)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'rightSidebarPerProject', 27.6, bool(false)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.show', 28, bool(false), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.position', 28.1, oneOf('bottom', USAGE_POSITIONS), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.compact', 28.2, bool(false), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.use24HourClock', 28.3, bool(false), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showAccount', 28.4, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showModel', 28.5, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showCache', 28.6, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showContext', 28.7, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showFiveHour', 28.8, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showSevenDay', 28.9, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'usage.showCost', 28.95, bool(true), ['agents', 'usage']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'accounts.activeAccount', 29, str(''), ['agents', 'accounts']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'accounts.showAllSessions', 29.1, bool(true), ['agents', 'accounts']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'accounts.shareProjects', 29.2, bool(true), ['agents', 'accounts']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'accounts.showOwner', 29.3, bool(false), ['agents', 'accounts']),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyNeedsYou', 30, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyDone', 40, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'notifyError', 50, bool(true)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'doNotDisturb', 55, bool(false)),
  groupField<AgentsViewSettings, 'agents'>('agents', 'claudeCommand', 60, str('')),
  claudeArgsDef,
  groupField<AgentsViewSettings, 'agents'>('agents', 'hooks.onRunning', 80, str('')),
  groupField<AgentsViewSettings, 'agents'>('agents', 'hooks.onWaiting', 90, str('')),
  groupField<AgentsViewSettings, 'agents'>('agents', 'hooks.onDone', 100, str('')),
  groupField<AgentsViewSettings, 'agents'>('agents', 'hooks.onError', 110, str('')),
];
