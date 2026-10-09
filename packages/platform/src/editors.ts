import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, win32 } from 'node:path';
import { PlatformError } from './errors.ts';
import { launch } from './launch.ts';

export type EditorId = 'vscode' | 'intellij';

export const EDITOR_NAMES: Record<EditorId, string> = { vscode: 'VS Code', intellij: 'IntelliJ IDEA' };

export interface EditorDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  which(cmd: string): string | null;
  exists(path: string): boolean;
  readText(path: string): Promise<string | null>;
  listDir(path: string): Promise<string[]>;
}

const defaultDeps: EditorDeps = {
  platform: process.platform,
  env: process.env,
  which: (cmd) => Bun.which(cmd),
  exists: (path) => existsSync(path),
  readText: (path) => readFile(path, 'utf8').catch(() => null),
  listDir: (path) => readdir(path).catch(() => []),
};

const versionOf = (name: string) => (name.match(/(\d+(?:\.\d+)*)$/)?.[1] ?? '').split('.').filter(Boolean).map(Number);

function compareVersions(a: string, b: string): number {
  const [x, y] = [versionOf(a), versionOf(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return a.localeCompare(b);
}

async function findOnWindows(id: EditorId, deps: EditorDeps): Promise<string | null> {
  const { env, exists } = deps;
  const local = env.LOCALAPPDATA;
  const programs = env.ProgramFiles;
  if (id === 'vscode') {
    const code = deps.which('code');
    if (code && /\x5cbin\x5ccode\.cmd$/i.test(code)) {
      const exe = win32.join(win32.dirname(code), '..', 'Code.exe');
      if (exists(exe)) return exe;
    }
    const candidates = [
      local && win32.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      programs && win32.join(programs, 'Microsoft VS Code', 'Code.exe'),
    ];
    return candidates.find((c): c is string => !!c && exists(c)) ?? null;
  }
  const script = deps.which('idea') ?? (local ? win32.join(local, 'JetBrains', 'Toolbox', 'scripts', 'idea.cmd') : null);
  const text = script ? await deps.readText(script) : null;
  const fromScript = text?.match(/"([^"]+\x5cidea64\.exe)"/i)?.[1];
  if (fromScript && exists(fromScript)) return fromScript;
  for (const base of [local && win32.join(local, 'Programs'), programs && win32.join(programs, 'JetBrains')]) {
    if (!base) continue;
    const folders = (await deps.listDir(base)).filter((name) => name.startsWith('IntelliJ IDEA')).sort(compareVersions);
    const newest = folders.at(-1);
    if (!newest) continue;
    const exe = win32.join(base, newest, 'bin', 'idea64.exe');
    if (exists(exe)) return exe;
  }
  return null;
}

/** The program that opens `id`, or null when it isn't installed (best-effort off Windows). */
export async function findEditor(id: EditorId, deps: EditorDeps = defaultDeps): Promise<string | null> {
  if (deps.platform === 'win32') return findOnWindows(id, deps);
  return deps.which(id === 'vscode' ? 'code' : 'idea');
}

export interface OpenInEditorOptions {
  /** The project folder (absolute). */
  folder: string;
  /** A file inside it (absolute). */
  file?: string;
  line?: number;
}

/** The argv that opens the project (and a file) in the editor; no shell is involved. */
export function editorArgv(id: EditorId, exe: string, opts: OpenInEditorOptions): string[] {
  const { folder, file, line } = opts;
  if (id === 'vscode') return file ? [exe, folder, '-g', `${file}:${line ?? 1}`] : [exe, folder];
  return file ? [exe, '--line', String(line ?? 1), file] : [exe, folder];
}

/**
 * Opens a project in an editor, detached. Rejects with PlatformError 'editorNotExe' unless `exe`
 * is an existing absolute path (on Windows a `.exe`): `code.cmd` and `idea.cmd` would go through
 * cmd.exe, which interprets `&`, `%` and `^` in a project path.
 */
export async function openInEditor(
  id: EditorId,
  exe: string,
  opts: OpenInEditorOptions,
  deps: Pick<EditorDeps, 'platform' | 'exists'> = defaultDeps,
): Promise<void> {
  const win = deps.platform === 'win32';
  const valid = win ? win32.isAbsolute(exe) && /\.exe$/i.test(exe) : isAbsolute(exe);
  if (!valid || !deps.exists(exe)) throw new PlatformError('editorNotExe', 'The editor program must be an existing .exe file.', exe);
  launch(editorArgv(id, exe, opts));
}
