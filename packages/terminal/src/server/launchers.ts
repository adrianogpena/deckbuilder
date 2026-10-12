export const LAUNCHER_ID = /^[a-z][a-z0-9-]{0,31}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);

export const isLauncherId = (x: unknown): x is string => typeof x === 'string' && LAUNCHER_ID.test(x);

/**
 * A program other than the shell that the client may start by id. The client never sends a program:
 * it sends a launcher id plus args, and only `command` builds the argv.
 *
 * `parse` is the security boundary. Accept only values with a fixed shape (ids, enums, UUIDs) and
 * return null for anything else; never pass free text through, since it could end up as a flag.
 */
export interface Launcher<A> {
  label: string;
  /** Validates untrusted client args; null = invalid. Accept only fixed-shape values, never free text. */
  parse(args: unknown): A | null;
  command(args: A, ctx: { shell: string[] }): string[];
  env?(args: A): Record<string, string>;
  meta?(args: A): Record<string, unknown>;
  available?(): boolean;
}

export interface ResolvedLaunch {
  cmd: string[];
  env: Record<string, string>;
  label: string;
  meta: Record<string, unknown>;
  launcher: string;
}

export interface Launchers {
  resolve(id: unknown, args: unknown, ctx: { shell: string[] }): ResolvedLaunch | null;
  list(): Array<{ id: string; label: string }>;
}

const isArgv = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === 'string');

export function launchers(map: Record<string, Launcher<any>>): Launchers {
  const registry = new Map<string, Launcher<any>>();
  for (const id of Object.keys(map)) {
    if (!isLauncherId(id)) throw new Error(`Invalid launcher id: ${JSON.stringify(id)}`);
    registry.set(id, map[id]!);
  }
  const isAvailable = (l: Launcher<unknown>): boolean => l.available?.() !== false;

  return {
    resolve(id, args, ctx) {
      if (!isLauncherId(id)) return null;
      const launcher = registry.get(id);
      if (!launcher || !isAvailable(launcher)) return null;
      const parsed = launcher.parse(args);
      if (parsed === null) return null;
      const cmd: unknown = launcher.command(parsed, ctx);
      if (!isArgv(cmd)) return null;
      return {
        cmd: [...cmd],
        env: launcher.env?.(parsed) ?? {},
        label: launcher.label,
        meta: launcher.meta?.(parsed) ?? {},
        launcher: id,
      };
    },
    list() {
      return [...registry].filter(([, l]) => isAvailable(l)).map(([id, l]) => ({ id, label: l.label }));
    },
  };
}
