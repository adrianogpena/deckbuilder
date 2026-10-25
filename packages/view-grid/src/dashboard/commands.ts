import type { CommandDef } from '@kedalion/ui';
import { tKey } from '../i18n';

/** Indices are used by DashboardScreen: append only, never reorder. */
export const dashboardCommands = (): CommandDef[] => [
  { id: 'dashboard.toggleSidePanel', scope: 'dashboard', label: tKey('keys.dashboard.toggleSidePanel'), keys: ['Ctrl+Alt+P'] },
];
