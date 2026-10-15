/** An OSC 133 mark: A prompt start, B prompt end (input starts), C command output starts, D command done with its exit code. */
export type PromptMark = { kind: 'A' } | { kind: 'B' } | { kind: 'C' } | { kind: 'D'; code: number | null };

/** Parses the data of an OSC 133 sequence (`A`, `B`, `C`, `D;0`, `D`); null for anything else. */
export function parseOsc133(data: string): PromptMark | null {
  const [kind, arg] = data.split(';');
  if (kind === 'A' || kind === 'B' || kind === 'C') return { kind };
  if (kind !== 'D') return null;
  const code = arg !== undefined && /^-?\d+$/.test(arg.trim()) ? Number(arg.trim()) : null;
  return { kind: 'D', code };
}

/**
 * The folder of an OSC 7 report (`file://host/path`, percent-encoded); a Windows drive path loses its
 * leading slash (`/C:/x` → `C:/x`). Null when it is not a file URL.
 */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    path = m[1];
  }
  return /^\/[A-Za-z]:([\\/]|$)/.test(path) ? path.slice(1) : path;
}

/** Values of the `{name}` placeholders in a tab title template. */
export interface TitleVars {
  name?: string;
  shell?: string;
  folder?: string;
  cwd?: string;
  title?: string;
}

/** Fills a tab title template; unknown placeholders stay as typed, empty ones vanish; the result is trimmed. */
export function formatTabTitle(template: string, vars: TitleVars): string {
  return template
    .replace(/\{(\w+)\}/g, (all, key: string) => (key in TITLE_KEYS ? (vars[key as keyof TitleVars] ?? '') : all))
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_KEYS = { name: 1, shell: 1, folder: 1, cwd: 1, title: 1 };
