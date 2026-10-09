import { expect, test } from 'bun:test';
import { type EditorDeps, editorArgv, findEditor, openInEditor } from './editors.ts';

const w = (s: string) => s.replaceAll('/', '\x5c');
const LOCAL = 'C:/Users/me/AppData/Local';
const IDEA_EXE = `${LOCAL}/Programs/IntelliJ IDEA Ultimate/bin/idea64.exe`;
const TOOLBOX = `@echo off\r\nstart "" "${w(IDEA_EXE)}" %*\r\n`;
const TOOLBOX_SCRIPT = `${LOCAL}/JetBrains/Toolbox/scripts/idea.cmd`;

interface Fake {
  files?: string[];
  texts?: Record<string, string>;
  dirs?: Record<string, string[]>;
  which?: Record<string, string>;
}

function deps(fake: Fake = {}): EditorDeps {
  const files = new Set((fake.files ?? []).map((f) => w(f).toLowerCase()));
  const texts = Object.fromEntries(Object.entries(fake.texts ?? {}).map(([k, v]) => [w(k), v]));
  const dirs = Object.fromEntries(Object.entries(fake.dirs ?? {}).map(([k, v]) => [w(k), v]));
  const which = Object.fromEntries(Object.entries(fake.which ?? {}).map(([k, v]) => [k, w(v)]));
  return {
    platform: 'win32',
    env: { LOCALAPPDATA: w(LOCAL), ProgramFiles: w('C:/Program Files') },
    which: (cmd) => which[cmd] ?? null,
    exists: (p) => files.has(p.toLowerCase()),
    readText: async (p) => texts[p] ?? null,
    listDir: async (p) => dirs[p] ?? [],
  };
}

test('vscode is found from code.cmd on PATH', async () => {
  const d = deps({ which: { code: 'C:/Tools/VS/bin/code.cmd' }, files: ['C:/Tools/VS/Code.exe'] });
  expect(await findEditor('vscode', d)).toBe(w('C:/Tools/VS/Code.exe'));
});

test('vscode is found under LOCALAPPDATA and then Program Files', async () => {
  const user = `${LOCAL}/Programs/Microsoft VS Code/Code.exe`;
  const system = 'C:/Program Files/Microsoft VS Code/Code.exe';
  expect(await findEditor('vscode', deps({ files: [user, system] }))).toBe(w(user));
  expect(await findEditor('vscode', deps({ files: [system] }))).toBe(w(system));
});

test('intellij is read from the Toolbox script, exe path with spaces', async () => {
  const d = deps({ files: [IDEA_EXE], texts: { [TOOLBOX_SCRIPT]: TOOLBOX } });
  expect(await findEditor('intellij', d)).toBe(w(IDEA_EXE));
});

test('intellij falls back to the newest IntelliJ IDEA folder', async () => {
  const programs = `${LOCAL}/Programs`;
  const newest = `${programs}/IntelliJ IDEA 2026.10/bin/idea64.exe`;
  const d = deps({
    files: [newest, `${programs}/IntelliJ IDEA 2026.2/bin/idea64.exe`],
    dirs: { [programs]: ['IntelliJ IDEA 2026.2', 'IntelliJ IDEA 2026.10', 'Other'] },
  });
  expect(await findEditor('intellij', d)).toBe(w(newest));
});

test('intellij picks the newest version across edition names', async () => {
  const programs = `${LOCAL}/Programs`;
  const newest = `${programs}/IntelliJ IDEA 2024.1.4/bin/idea64.exe`;
  const d = deps({
    files: [newest, `${programs}/IntelliJ IDEA Community Edition 2023.3.2/bin/idea64.exe`],
    dirs: { [programs]: ['IntelliJ IDEA 2024.1.4', 'IntelliJ IDEA Community Edition 2023.3.2'] },
  });
  expect(await findEditor('intellij', d)).toBe(w(newest));
});

test('nothing installed gives null', async () => {
  expect(await findEditor('vscode', deps())).toBeNull();
  expect(await findEditor('intellij', deps())).toBeNull();
});

test('other platforms use which', async () => {
  const d: EditorDeps = { ...deps(), platform: 'linux', which: (cmd) => (cmd === 'code' ? '/usr/bin/code' : null) };
  expect(await findEditor('vscode', d)).toBe('/usr/bin/code');
  expect(await findEditor('intellij', d)).toBeNull();
});

test('editorArgv for both editors, with and without a file', () => {
  const folder = w('C:/p');
  const file = w('C:/p/a.ts');
  expect(editorArgv('vscode', 'Code.exe', { folder })).toEqual(['Code.exe', folder]);
  expect(editorArgv('vscode', 'Code.exe', { folder, file })).toEqual(['Code.exe', folder, '-g', `${file}:1`]);
  expect(editorArgv('vscode', 'Code.exe', { folder, file, line: 7 })).toEqual(['Code.exe', folder, '-g', `${file}:7`]);
  expect(editorArgv('intellij', 'idea64.exe', { folder })).toEqual(['idea64.exe', folder]);
  expect(editorArgv('intellij', 'idea64.exe', { folder, file, line: 7 })).toEqual(['idea64.exe', '--line', '7', file]);
});

test('openInEditor refuses scripts and relative paths', async () => {
  const d = deps({ files: ['C:/x/idea.cmd', 'code.exe'] });
  const opts = { folder: w('C:/p') };
  expect(await openInEditor('intellij', w('C:/x/idea.cmd'), opts, d).catch((e) => e)).toMatchObject({ code: 'editorNotExe' });
  expect(await openInEditor('vscode', 'code.exe', opts, d).catch((e) => e)).toMatchObject({ code: 'editorNotExe' });
});
