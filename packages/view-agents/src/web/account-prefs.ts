import { ACCOUNT_STATUS_ICONS, type AccountPrefs, type AccountPrefsMap, type AccountStatusKey, type AgentStatus } from '../protocol.ts';
import type { UsageSettings } from './UsageView';

export { ACCOUNT_STATUS_ICONS, ACCOUNT_STATUS_KEYS, type AccountPrefs, type AccountPrefsMap, type AccountStatusKey } from '../protocol.ts';

/** The status key whose icon an account can change, or undefined for statuses that keep the built-in dot (starting, done, error). `exited` counts as stopped. */
export function accountStatusKey(status: AgentStatus): AccountStatusKey | undefined {
  switch (status) {
    case 'running': return 'running';
    case 'needs-you': return 'waiting';
    case 'idle': return 'idle';
    case 'stopped':
    case 'exited': return 'stopped';
    default: return undefined;
  }
}

/** The built-in icon id of a status (the first of its curated list). */
export const defaultStatusIcon = (key: AccountStatusKey): string => ACCOUNT_STATUS_ICONS[key][0]!;

/** The icon id an account shows for a status: its override, else the built-in default. Unknown ids fall back to the default. */
export function statusIconFor(prefs: AccountPrefsMap | undefined, accountId: string | undefined, status: AccountStatusKey): string {
  const id = accountId ? prefs?.[accountId]?.icons?.[status] : undefined;
  return id && ACCOUNT_STATUS_ICONS[status].includes(id) ? id : defaultStatusIcon(status);
}

/** The global usage settings with the account's overrides applied (`globalUsage` itself when the account has none). */
export function resolveUsage(prefs: AccountPrefsMap | undefined, accountId: string | undefined, globalUsage: UsageSettings): UsageSettings {
  const u = accountId ? prefs?.[accountId]?.usage : undefined;
  if (!u) return globalUsage;
  return {
    show: u.show ?? globalUsage.show,
    position: u.position ?? globalUsage.position,
    compact: u.compact ?? globalUsage.compact,
    use24h: u.use24HourClock ?? globalUsage.use24h,
    items: {
      account: u.showAccount ?? globalUsage.items.account,
      model: u.showModel ?? globalUsage.items.model,
      cache: u.showCache ?? globalUsage.items.cache,
      context: u.showContext ?? globalUsage.items.context,
      fiveHour: u.showFiveHour ?? globalUsage.items.fiveHour,
      sevenDay: u.showSevenDay ?? globalUsage.items.sevenDay,
      cost: u.showCost ?? globalUsage.items.cost,
    },
  };
}

/** `prefs` with one account's entry replaced (an empty entry is dropped); does not mutate. */
export function withAccountPrefs(prefs: AccountPrefsMap, accountId: string, next: AccountPrefs): AccountPrefsMap {
  const { [accountId]: _old, ...rest } = prefs;
  return next.usage && Object.keys(next.usage).length || next.icons && Object.keys(next.icons).length ? { ...rest, [accountId]: next } : rest;
}
