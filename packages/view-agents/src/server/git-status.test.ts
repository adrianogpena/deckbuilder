import { describe, expect, test } from 'bun:test';
import { createGitPoller, parsePorcelainV2 } from './git-status.ts';

describe('parsePorcelainV2', () => {
  test('branch with ahead/behind and every entry kind', () => {
    const text = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '1 .M N... 100644 100644 100644 a b a.ts',
      '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked.ts',
    ].join('\n');
    expect(parsePorcelainV2(text)).toEqual({ branch: 'main', ahead: 2, behind: 3, dirty: 4 });
  });

  test('no upstream is 0/0', () => {
    expect(parsePorcelainV2('# branch.oid abc\n# branch.head dev\n')).toEqual({ branch: 'dev', ahead: 0, behind: 0, dirty: 0 });
  });

  test('detached has no branch', () => {
    expect(parsePorcelainV2('# branch.head (detached)\n? x\n').branch).toBeNull();
  });
});

describe('createGitPoller', () => {
  const out = '# branch.head main\n? x\n';

  test('de-duplicates cwds, caps concurrency at 6 and fills the cache', async () => {
    let active = 0;
    let peak = 0;
    const calls: string[] = [];
    const cwds = Array.from({ length: 10 }, (_, i) => `/p${i}`);
    const p = createGitPoller({
      cwds: () => [...cwds, ...cwds],
      run: async (cwd) => {
        calls.push(cwd);
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return out;
      },
    });
    await p.pollNow();
    expect(calls.length).toBe(10);
    expect(peak).toBe(6);
    expect(p.get()['/p3']).toEqual({ branch: 'main', ahead: 0, behind: 0, dirty: 1 });
  });

  test('does not overlap and failures are left out', async () => {
    let calls = 0;
    const p = createGitPoller({
      cwds: () => ['/a', '/b'],
      run: async (cwd) => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return cwd === '/a' ? out : null;
      },
    });
    await Promise.all([p.pollNow(), p.pollNow()]);
    expect(calls).toBe(2);
    expect(Object.keys(p.get())).toEqual(['/a']);
  });

  test('disabled never runs git', async () => {
    let calls = 0;
    const p = createGitPoller({ cwds: () => ['/a'], enabled: false, run: async () => (calls++, out) });
    await p.pollNow();
    expect(calls).toBe(0);
    expect(p.get()).toEqual({});
  });

  test('disabling clears the cache and notifies; enabling polls', async () => {
    const updates: number[] = [];
    const p = createGitPoller({ cwds: () => ['/a'], run: async () => out, onUpdate: (c) => updates.push(Object.keys(c).length) });
    await p.pollNow();
    p.setEnabled(false);
    p.start();
    p.setEnabled(true);
    await p.pollNow();
    p.stop();
    expect(updates).toEqual([1, 0, 1]);
  });
});
