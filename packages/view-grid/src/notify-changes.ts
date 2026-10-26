import type { SourceContext } from './server';

const MAX_LINES = 3;

const seen = new Map<string, Map<string, string>>();

export interface NotifyChangesOptions<T> {
  /** Stable identity of an item. */
  key(item: T): string;
  /** Changes when the item changed in a way worth a toast; a constant notifies only new items. */
  sig(item: T): string;
  title: string;
  /** One line of the toast per new or changed item. */
  line(item: T): string;
}

/**
 * Toasts the items that are new or whose `sig` changed since the last call with the same `scope`
 * (one toast per call). The first call of a scope only records the items. `scope` should hold the
 * source id and the config, so two panels with different settings do not share state.
 */
export function notifyChanges<T>(ctx: Pick<SourceContext, 'notify'>, scope: string, items: readonly T[], o: NotifyChangesOptions<T>): void {
  const next = new Map(items.map((i) => [o.key(i), o.sig(i)] as const));
  const prev = seen.get(scope);
  seen.set(scope, next);
  if (!prev || !ctx.notify) return;
  const changed = items.filter((i) => prev.get(o.key(i)) !== next.get(o.key(i)));
  if (changed.length === 0) return;
  const lines = changed.slice(0, MAX_LINES).map(o.line);
  if (changed.length > MAX_LINES) lines.push(`and ${changed.length - MAX_LINES} more`);
  ctx.notify({ title: o.title, body: lines.join('\n') }).catch(() => {});
}

/** `scope` for a source id and its config: the same settings always give the same string. */
export const notifyScope = (sourceId: string, config: Record<string, unknown>): string =>
  `${sourceId}:${JSON.stringify(Object.keys(config).sort().map((k) => [k, config[k]]))}`;

export const resetNotifyChanges = (): void => seen.clear();
