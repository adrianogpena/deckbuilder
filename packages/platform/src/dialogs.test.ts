import { expect, test } from 'bun:test';
import { confirmArgv, confirmDialog, confirmScript, type DialogDeps, dialogScript, pickFile, pickFolder, saveFileAs } from './dialogs.ts';

function fakeSpawn(stdout: string, code = 0) {
  const calls: Array<{ script: string; stdin: string }> = [];
  const deps: DialogDeps = {
    spawn: (script) => {
      const call = { script, stdin: '' };
      calls.push(call);
      return {
        stdin: { write: (data: string) => (call.stdin += data), end: () => {} },
        stdout: new Response(stdout).body!,
        stderr: new Response('boom').body!,
        exited: Promise.resolve(code),
      };
    },
  };
  return { calls, deps };
}

test('the folder script picks folders and reads its options from stdin', () => {
  const script = dialogScript('folder');
  expect(script).toContain('FOS_PICKFOLDERS');
  expect(script).toContain('[Console]::In.ReadToEnd() | ConvertFrom-Json');
  expect(dialogScript('save')).toContain('FOS_OVERWRITEPROMPT');
  expect(dialogScript('file')).not.toContain('FOS_PICKFOLDERS -bor');
});

test('options go in on stdin only, never in the script', async () => {
  const { calls, deps } = fakeSpawn(String.raw`{"path":"C:\\tmp\\a\u00e7.md"}`);
  const title = `a'b";$x`;
  expect(await saveFileAs({ title, suggestedName: 'n.md', filters: [{ name: 'Markdown', patterns: ['*.md'] }] }, deps)).toBe('C:\\tmp\\aç.md');
  expect(calls[0]!.script).not.toContain(title);
  expect(JSON.parse(calls[0]!.stdin)).toEqual({ title, start: '', name: 'n.md', filters: [{ name: 'Markdown', patterns: ['*.md'] }] });
});

test('the save dialog takes a start folder', async () => {
  const { calls, deps } = fakeSpawn('{"path":null}');
  expect(await saveFileAs({ suggestedName: 'untitled.sql', start: 'C:\\work\\proj' }, deps)).toBeNull();
  expect(JSON.parse(calls[0]!.stdin)).toMatchObject({ start: 'C:\\work\\proj', name: 'untitled.sql' });
});

test('cancel gives null, a failing host gives dialogFailed', async () => {
  expect(await pickFolder({}, fakeSpawn('{"path":null}').deps)).toBeNull();
  expect(await pickFile({}, fakeSpawn('', 1).deps).catch((e) => e)).toMatchObject({ code: 'dialogFailed', detail: 'boom' });
});

test('a second dialog while one is open is dialogBusy', async () => {
  let release!: (code: number) => void;
  const deps: DialogDeps = {
    spawn: () => ({
      stdin: { write: () => {}, end: () => {} },
      stdout: new Response('{"path":null}').body!,
      stderr: new Response('').body!,
      exited: new Promise((resolve) => (release = resolve)),
    }),
  };
  const first = pickFolder({}, deps);
  expect(await pickFolder({}, deps).catch((e) => e)).toMatchObject({ code: 'dialogBusy' });
  release(0);
  expect(await first).toBeNull();
});

test('the confirm script reads its texts from stdin and defaults to No', async () => {
  const script = confirmScript();
  expect(script).toContain('[Console]::In.ReadToEnd() | ConvertFrom-Json');
  expect(script).toContain('MessageBoxDefaultButton]::Button2');
  const { calls, deps } = fakeSpawn('yes');
  const message = `run "x"; $(rm -rf /) 'ção'`;
  expect(await confirmDialog({ title: 'T', message }, deps)).toBe(true);
  expect(calls[0]!.script).not.toContain(message);
  expect(JSON.parse(calls[0]!.stdin)).toEqual({ title: 'T', message, ok: 'OK' });
});

test('confirm is false on No or a failing host', async () => {
  expect(await confirmDialog({ title: 'T', message: 'm' }, fakeSpawn('no').deps)).toBe(false);
  expect(await confirmDialog({ title: 'T', message: 'm' }, fakeSpawn('yes', 1).deps)).toBe(false);
});

test('confirm argv keeps the texts as separate arguments', () => {
  const opts = { title: 'T', message: 'echo <b>"x"</b>', ok: 'Allow' };
  const mac = confirmArgv('osascript', opts);
  expect(mac.slice(-4)).toEqual(['--', 'T', 'echo <b>"x"</b>', 'Allow']);
  expect(mac.filter((_, i) => mac[i - 1] === '-e').join('\n')).not.toContain('echo');
  expect(confirmArgv('zenity', opts)).toEqual(['zenity', '--question', '--no-markup', '--default-cancel', '--title=T', '--text=echo <b>"x"</b>', '--ok-label=Allow']);
  expect(confirmArgv('kdialog', opts)).toEqual(['kdialog', '--title', 'T', '--yes-label', 'Allow', '--yesno', 'echo <b>"x"</b>']);
});
