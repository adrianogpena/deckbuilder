import { relative, resolve } from 'node:path';

const WRITE_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/;

export interface SessionTouched {
  /** Absolute paths (slashes normalised) the session wrote through its edit tools. */
  paths: string[];
  /** Timestamp (ms) of the first transcript entry; undefined when none has one. */
  startedAt?: number;
}

/** The files a transcript's Edit / MultiEdit / Write / NotebookEdit calls changed, and when the session started. */
export function touchedFiles(jsonl: string, cwd: string): SessionTouched {
  const paths = new Set<string>();
  let startedAt: number | undefined;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: { timestamp?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (startedAt === undefined && typeof entry.timestamp === 'string') {
      const at = Date.parse(entry.timestamp);
      if (!Number.isNaN(at)) startedAt = at;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<Record<string, unknown>>) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string' || !WRITE_TOOLS.test(b.name)) continue;
      const input = (b.input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
      const p = [input.file_path, input.notebook_path].find((x): x is string => typeof x === 'string');
      if (p) paths.add(resolve(cwd, p).replaceAll('\\', '/'));
    }
  }
  return { paths: [...paths], startedAt };
}

/** `abs` relative to the repo top-level, in git's spelling (forward slashes); undefined when outside it. Case-insensitive on Windows. */
export function repoRelative(top: string, abs: string): string | undefined {
  const rel = relative(top, abs).replaceAll('\\', '/');
  return rel === '' || rel.startsWith('../') || /^[a-z]:/i.test(rel) ? undefined : rel;
}
