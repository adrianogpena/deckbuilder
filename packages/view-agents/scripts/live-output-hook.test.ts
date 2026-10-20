import { describe, expect, test } from 'bun:test';
import { hookOutput, liveLogPath, wrapCommand } from './live-output-hook.ts';

describe('live output hook', () => {
  test('wraps the command and keeps it intact', () => {
    const w = wrapCommand("echo 'hi'", 'C:\\a b\\live\\s.log');
    expect(w).toContain("{\necho 'hi'\n}");
    expect(w).toContain("'C:/a b/live/s.log'");
  });

  test('leaves background and non-Bash calls alone', () => {
    expect(hookOutput({ session_id: 's', tool_name: 'Bash', tool_input: { command: 'x', run_in_background: true } }, '/tmp/none')).toBeUndefined();
    expect(hookOutput({ session_id: 's', tool_name: 'Read', tool_input: { command: 'x' } }, '/tmp/none')).toBeUndefined();
  });

  test('sanitizes the session id in the file name', () => {
    expect(liveLogPath('/a', '../x')).toMatch(/\.{0}[\\/]live[\\/]___x\.log$/);
  });
});
