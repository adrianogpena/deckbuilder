export const SHELL_IDS = ['auto', 'powershell', 'pwsh', 'cmd', 'git-bash', 'wsl', 'bash', 'zsh', 'fish', 'sh'] as const;
export type ShellId = (typeof SHELL_IDS)[number];

export const isShellId = (x: unknown): x is ShellId => typeof x === 'string' && (SHELL_IDS as readonly string[]).includes(x);

export interface ShellLookup {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
}

const POSIX_DIRS = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];

const firstExisting = (paths: string[], exists: (p: string) => boolean): string | undefined => paths.find(exists);

const posixArgs = (name: string): string[] => {
  if (name === 'zsh') return ['-l', '-o', 'nopromptsp'];
  if (name === 'bash' || name === 'fish' || name === 'sh' || name === 'dash') return ['-l'];
  return [];
};

const posixShell = (name: string, { exists }: ShellLookup): string[] | null => {
  const path = firstExisting(
    POSIX_DIRS.map((d) => `${d}/${name}`),
    exists,
  );
  return path ? [path, ...posixArgs(name)] : null;
};

function windowsShell(id: ShellId, { env, exists }: ShellLookup): string[] | null {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'];
  const localAppData = env.LOCALAPPDATA;
  const pick = (paths: (string | undefined)[], args: string[] = []): string[] | null => {
    const found = firstExisting(paths.filter((p): p is string => !!p), exists);
    return found ? [found, ...args] : null;
  };
  switch (id) {
    case 'powershell':
      return pick([`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`], ['-NoLogo']);
    case 'pwsh':
      return pick(
        [`${programFiles}\\PowerShell\\7\\pwsh.exe`, localAppData && `${localAppData}\\Microsoft\\WindowsApps\\pwsh.exe`],
        ['-NoLogo'],
      );
    case 'cmd':
      return pick([`${root}\\System32\\cmd.exe`]);
    case 'wsl':
      return pick([`${root}\\System32\\wsl.exe`]);
    case 'git-bash':
      return pick(
        [
          `${programFiles}\\Git\\bin\\bash.exe`,
          programFilesX86 && `${programFilesX86}\\Git\\bin\\bash.exe`,
          localAppData && `${localAppData}\\Programs\\Git\\bin\\bash.exe`,
        ],
        ['--login', '-i'],
      );
    default:
      return null;
  }
}

function posixAuto(lookup: ShellLookup): string[] | null {
  const login = lookup.env.SHELL;
  if (login && login.startsWith('/') && lookup.exists(login)) return [login, ...posixArgs(login.slice(login.lastIndexOf('/') + 1))];
  return posixShell('bash', lookup) ?? posixShell('sh', lookup);
}

/** Argv for a known shell id on this machine; null when the id doesn't apply to the platform or isn't installed. */
export function resolveShell(id: ShellId, lookup: ShellLookup): string[] | null {
  if (lookup.platform === 'win32') {
    return id === 'auto' ? windowsShell('powershell', lookup) : windowsShell(id, lookup);
  }
  switch (id) {
    case 'auto':
      return posixAuto(lookup);
    case 'pwsh': {
      const path = firstExisting(['/usr/local/bin/pwsh', '/usr/bin/pwsh', '/opt/homebrew/bin/pwsh', '/opt/microsoft/powershell/7/pwsh'], lookup.exists);
      return path ? [path, '-NoLogo'] : null;
    }
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'sh':
      return posixShell(id, lookup);
    default:
      return null;
  }
}

export function availableShells(lookup: ShellLookup): ShellId[] {
  return SHELL_IDS.filter((id) => resolveShell(id, lookup) !== null);
}
