import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capOutput, cleanOutput, lastBashRun, liveLogPath, MAX_OUTPUT, MAX_RUNS, parseRuns, stateOf } from './output.ts';

const use = (id: string, name: string, input: unknown) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, content: unknown, is_error = false) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });

describe('lastBashRun', () => {
  test('a call without a result is running', () => {
    const run = lastBashRun(use('a', 'Bash', { command: 'ls' }));
    expect(run?.command).toBe('ls');
    expect(stateOf(run!, 1).status).toBe('running');
  });

  test('pairs the result by id and ignores other tools', () => {
    const run = lastBashRun([use('a', 'Bash', { command: 'ls' }), result('a', 'x\ny'), use('b', 'Read', { file_path: 'f' }), result('b', 'file')].join('\n'));
    expect(stateOf(run!, 1)).toMatchObject({ command: 'ls', status: 'done', output: 'x\ny', toolUseId: 'a' });
  });

  test('the newest Bash call replaces the previous one', () => {
    const run = lastBashRun([use('a', 'Bash', { command: 'one' }), result('a', 'o1'), use('b', 'Bash', { command: 'two' }), result('b', [{ type: 'text', text: 'boom' }], true)].join('\n'));
    expect(stateOf(run!, 1)).toMatchObject({ command: 'two', status: 'error', output: 'boom' });
  });

  test('reads the background task id and output file, and its end', () => {
    const early = 'Command running in background with ID: bg1. Output is being written to: /tmp/none-bg1.output';
    const lines = [use('a', 'Bash', { command: 'sleep 9', run_in_background: true }), result('a', early)];
    const run = lastBashRun(lines.join('\n'));
    expect(run).toMatchObject({ background: true, taskId: 'bg1', outputFile: '/tmp/none-bg1.output', ended: false });
    const ended = lastBashRun([...lines, use('k', 'KillShell', { shell_id: 'bg1' })].join('\n'));
    expect(ended?.ended).toBe(true);
  });
});

const stamped = (ts: string, body: string) => JSON.stringify({ ...JSON.parse(body), timestamp: ts });

describe('parseRuns', () => {
  const early = 'Command running in background with ID: bg1. Output is being written to: /tmp/none-bg1.output';
  const bg = [use('a', 'Bash', { command: 'sleep 9', run_in_background: true }), result('a', early)];

  test('BashOutput completion ends a background run with its exit code', () => {
    const poll = [use('p', 'BashOutput', { bash_id: 'bg1' }), result('p', '<status>completed</status><exit_code>2</exit_code><stdout>out</stdout>')];
    const run = parseRuns([...bg, ...poll].join('\n'))[0]!;
    expect(run).toMatchObject({ ended: true, exitCode: 2, failed: true, polled: 'out' });
    expect(stateOf(run, 1)).toMatchObject({ status: 'error', output: 'out', exitCode: 2, source: 'poll' });
  });

  test('a running BashOutput does not end the run', () => {
    const run = parseRuns([...bg, use('p', 'BashOutput', { bash_id: 'bg1' }), result('p', '<status>running</status><stdout>x</stdout>')].join('\n'))[0]!;
    expect(run.ended).toBe(false);
    expect(stateOf(run, 1).status).toBe('running');
  });

  test('keeps the last runs with times and exit code', () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_RUNS + 3; i++) lines.push(stamped('2026-01-01T00:00:00Z', use(`r${i}`, 'Bash', { command: `c${i}` })), stamped('2026-01-01T00:00:05Z', result(`r${i}`, 'Exit code 3\nboom', true)));
    const runs = parseRuns(lines.join('\n'));
    expect(runs.length).toBe(MAX_RUNS);
    expect(runs.at(-1)).toMatchObject({ command: `c${MAX_RUNS + 2}`, exitCode: 3, startedAt: Date.parse('2026-01-01T00:00:00Z'), endedAt: Date.parse('2026-01-01T00:00:05Z') });
  });

  test('an older call without a result is an interrupted error', () => {
    const run = parseRuns(use('a', 'Bash', { command: 'ls' }))[0]!;
    expect(stateOf(run, 1, Date.now(), { latest: false }).status).toBe('error');
  });
});

describe('live log', () => {
  test('a running foreground call shows the live log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-'));
    try {
      const file = liveLogPath(dir, 's1');
      mkdirSync(join(dir, 'live'));
      writeFileSync(file, 'partial\n');
      const run = lastBashRun(use('a', 'Bash', { command: 'ls' }))!;
      expect(stateOf(run, 1, Date.now(), { live: file })).toMatchObject({ status: 'running', output: 'partial\n', source: 'live' });
      expect(stateOf({ ...run, result: 'final' }, 1, Date.now(), { live: file })).toMatchObject({ status: 'done', output: 'final', source: 'result' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cleanOutput', () => {
  test('keeps colors, drops other escapes and keeps the last bytes', () => {
    expect(cleanOutput('\u001b[31mred\u001b[0m\u001b[2K\u001b]0;t\u0007')).toBe('\u001b[31mred\u001b[0m');
    expect(cleanOutput('a'.repeat(MAX_OUTPUT + 5)).length).toBe(MAX_OUTPUT);
  });

  test('reports the truncation', () => {
    expect(capOutput('a'.repeat(MAX_OUTPUT + 1)).truncated).toBe(true);
    expect(capOutput('abc').truncated).toBe(false);
  });
});
