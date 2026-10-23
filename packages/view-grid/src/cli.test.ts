import { describe, expect, test } from 'bun:test';
import { runCli } from './cli.ts';

describe('runCli', () => {
  test('captures stdout and the exit code', async () => {
    const res = await runCli([process.execPath, '--version'], { timeoutMs: 10_000 });
    expect(res.code).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
  });

  test('a missing tool throws source-tool-missing', async () => {
    await expect(runCli(['no-such-tool-xyz'], { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'source-tool-missing' });
  });
});
