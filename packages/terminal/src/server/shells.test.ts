import { describe, expect, test } from 'bun:test';
import { availableShells, isShellId, resolveShell, type ShellLookup } from './shells.ts';

const lookup = (platform: NodeJS.Platform, present: string[], env: Record<string, string> = {}): ShellLookup => ({
  platform,
  env,
  exists: (p) => present.includes(p),
});

const winEnv = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

describe('isShellId', () => {
  test('accepts ids and rejects paths', () => {
    expect(isShellId('git-bash')).toBe(true);
    expect(isShellId('auto')).toBe(true);
    expect(isShellId('/bin/bash')).toBe(false);
    expect(isShellId('C:\\Windows\\System32\\cmd.exe')).toBe(false);
    expect(isShellId(undefined)).toBe(false);
    expect(isShellId(1)).toBe(false);
  });
});

describe('resolveShell on Windows', () => {
  const present = [
    PS,
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\System32\\wsl.exe',
    'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
  ];
  const l = lookup('win32', present, winEnv);

  test('auto is Windows PowerShell', () => {
    expect(resolveShell('auto', l)).toEqual([PS, '-NoLogo']);
  });

  test('known shells resolve with their arguments', () => {
    expect(resolveShell('cmd', l)).toEqual(['C:\\Windows\\System32\\cmd.exe']);
    expect(resolveShell('wsl', l)).toEqual(['C:\\Windows\\System32\\wsl.exe']);
    expect(resolveShell('git-bash', l)).toEqual(['C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe', '--login', '-i']);
  });

  test('git-bash prefers Program Files', () => {
    const both = lookup('win32', [...present, 'C:\\Program Files\\Git\\bin\\bash.exe'], winEnv);
    expect(resolveShell('git-bash', both)?.[0]).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  test('missing pwsh and POSIX ids are null', () => {
    expect(resolveShell('pwsh', l)).toBeNull();
    expect(resolveShell('bash', l)).toBeNull();
    expect(resolveShell('zsh', l)).toBeNull();
  });

  test('pwsh is found under Program Files', () => {
    const withPwsh = lookup('win32', [...present, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'], winEnv);
    expect(resolveShell('pwsh', withPwsh)).toEqual(['C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoLogo']);
  });

  test('availableShells lists what resolves', () => {
    expect(availableShells(l)).toEqual(['auto', 'powershell', 'cmd', 'git-bash', 'wsl']);
  });
});

describe('resolveShell on POSIX', () => {
  test('auto picks $SHELL, with login args', () => {
    const l = lookup('linux', ['/usr/bin/fish', '/bin/bash'], { SHELL: '/usr/bin/fish' });
    expect(resolveShell('auto', l)).toEqual(['/usr/bin/fish', '-l']);
  });

  test('auto uses zsh without the partial-line marker', () => {
    const l = lookup('darwin', ['/bin/zsh'], { SHELL: '/bin/zsh' });
    expect(resolveShell('auto', l)).toEqual(['/bin/zsh', '-l', '-o', 'nopromptsp']);
  });

  test('auto falls back to bash, then sh', () => {
    expect(resolveShell('auto', lookup('linux', ['/bin/bash', '/bin/sh'], { SHELL: '/gone/zsh' }))).toEqual(['/bin/bash', '-l']);
    expect(resolveShell('auto', lookup('linux', ['/bin/sh']))).toEqual(['/bin/sh', '-l']);
    expect(resolveShell('auto', lookup('linux', []))).toBeNull();
  });

  test('a relative $SHELL is ignored', () => {
    expect(resolveShell('auto', lookup('linux', ['bash', '/bin/sh'], { SHELL: 'bash' }))).toEqual(['/bin/sh', '-l']);
  });

  test('named shells and platform mismatches', () => {
    const l = lookup('linux', ['/usr/bin/zsh', '/usr/bin/bash']);
    expect(resolveShell('zsh', l)).toEqual(['/usr/bin/zsh', '-l', '-o', 'nopromptsp']);
    expect(resolveShell('bash', l)).toEqual(['/usr/bin/bash', '-l']);
    expect(resolveShell('fish', l)).toBeNull();
    expect(resolveShell('cmd', l)).toBeNull();
    expect(resolveShell('powershell', l)).toBeNull();
    expect(resolveShell('git-bash', l)).toBeNull();
    expect(resolveShell('wsl', l)).toBeNull();
  });

  test('pwsh resolves when installed', () => {
    expect(resolveShell('pwsh', lookup('linux', ['/usr/bin/pwsh']))).toEqual(['/usr/bin/pwsh', '-NoLogo']);
    expect(resolveShell('pwsh', lookup('linux', []))).toBeNull();
  });
});
