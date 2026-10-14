import { invalid } from '@deckbuilder/server-core';
import { REST_BUILTIN_VARIABLES, REST_VAR_REFERENCE } from '@deckbuilder/server-core/protocol';

/** Names `{{$name}}` resolves without an environment. */
export const BUILTIN_VARIABLES = REST_BUILTIN_VARIABLES;

const REFERENCE = REST_VAR_REFERENCE;

/** The distinct variable names `text` refers to, in order of first use. */
export function variableNames(text: string): string[] {
  return [...new Set([...text.matchAll(REFERENCE)].map((m) => m[1]!))];
}

export interface VariableResolver {
  /** `text` with every known `{{name}}` replaced; unknown names are collected and left as they are. */
  resolve(text: string): string;
  /** Unknown names seen so far, in order of first use. */
  readonly missing: string[];
  /** Throws `unknownVariable` (params.names = comma-separated list) when any name was unknown. */
  check(): void;
}

/**
 * Resolves `{{name}}` against `vars` (own keys only) and the built-ins. `$timestamp` and
 * `$isoTimestamp` are fixed per resolver (one request sees one time); `$uuid` and `$randomInt`
 * (0..1000) are fresh at each use.
 */
export function variableResolver(vars: Record<string, string> = {}, now: () => Date = () => new Date()): VariableResolver {
  const missing: string[] = [];
  let at: Date | undefined;
  const time = () => (at ??= now());
  const builtin = (name: string): string | undefined => {
    switch (name) {
      case '$timestamp':
        return String(Math.floor(time().getTime() / 1000));
      case '$isoTimestamp':
        return time().toISOString();
      case '$uuid':
        return crypto.randomUUID();
      case '$randomInt':
        return String(Math.floor(Math.random() * 1001));
      default:
        return undefined;
    }
  };
  return {
    resolve: (text) =>
      text.replace(REFERENCE, (whole, name: string) => {
        const value = Object.hasOwn(vars, name) ? vars[name] : builtin(name);
        if (value !== undefined) return value;
        if (!missing.includes(name)) missing.push(name);
        return whole;
      }),
    missing,
    check() {
      if (missing.length) throw unknownVariables(missing);
    },
  };
}

export const unknownVariables = (names: string[]) => invalid('unknownVariable', `Unknown variables: ${names.join(', ')}.`, { names: names.join(', ') });
