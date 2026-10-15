import { describe, expect, test } from 'bun:test';
import { mergeProfiles, profileArgv } from './profiles.ts';
import type { ShellLookup } from './shells.ts';

const linux = (present: string[]): ShellLookup => ({ platform: 'linux', env: { SHELL: '/bin/bash' }, exists: (p) => present.includes(p) });

describe('mergeProfiles', () => {
  test('one built-in per installed shell, with names and icons; overrides apply; custom ones follow', () => {
    const lookup = linux(['/bin/bash', '/usr/bin/zsh', '/opt/tool']);
    const list = mergeProfiles(
      [
        { id: 'zsh', name: 'Z', shell: 'zsh', args: ['-x'], hidden: true, command: '/ignored' },
        { id: 'fish', name: 'F', shell: 'fish' },
        { id: 'tool', name: 'Tool', shell: 'custom', command: '/opt/tool' },
        { id: 'gone', name: 'Gone', shell: 'custom', command: '/opt/missing' },
      ],
      lookup,
    );
    expect(list.map((p) => p.id)).toEqual(['bash', 'zsh', 'tool', 'gone']);
    expect(list[0]).toEqual({ id: 'bash', name: 'bash', shell: 'bash', icon: 'shell-bash', available: true });
    expect(list[1]).toEqual({ id: 'zsh', name: 'Z', shell: 'zsh', icon: 'shell-zsh', args: ['-x'], hidden: true, available: true });
    expect(list[2]!.available).toBe(true);
    expect(list[3]!.available).toBe(false);
  });

  test('Windows built-ins get display names', () => {
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const list = mergeProfiles([], { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: (p) => p === ps });
    expect(list).toEqual([{ id: 'powershell', name: 'PowerShell', shell: 'powershell', icon: 'shell-powershell', available: true }]);
  });
});

describe('profileArgv', () => {
  const lookup = linux(['/bin/bash', '/opt/tool']);
  test('a known shell gets its args appended', () => {
    expect(profileArgv({ id: 'x', name: 'x', shell: 'bash', args: ['--norc'] }, lookup)).toEqual(['/bin/bash', '-l', '--norc']);
  });
  test('a custom command must be absolute and exist', () => {
    expect(profileArgv({ id: 'x', name: 'x', shell: 'custom', command: '/opt/tool', args: ['a'] }, lookup)).toEqual(['/opt/tool', 'a']);
    expect(profileArgv({ id: 'x', name: 'x', shell: 'custom', command: 'tool' }, linux(['tool']))).toBeNull();
    expect(profileArgv({ id: 'x', name: 'x', shell: 'custom' }, lookup)).toBeNull();
    expect(profileArgv({ id: 'x', name: 'x', shell: 'fish' }, lookup)).toBeNull();
  });
});
