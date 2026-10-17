import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgents, listSkills, parseFrontmatter } from './skills.ts';

let dir = '';
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'skills-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, text: string) => {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
};

test('parseFrontmatter handles quotes, folded blocks and empties', () => {
  const fm = parseFrontmatter('---\nname: "Foo"\ndescription: >\n  one\n  two\n  indented: x\nempty:\n---\nname: no');
  expect(fm).toEqual({ name: 'Foo', description: 'one two indented: x' });
  expect(parseFrontmatter('no frontmatter')).toEqual({});
});

test('listSkills applies overrides and frontmatter', () => {
  put('skills/b/SKILL.md', '---\ndescription: B desc\n---\n');
  put('skills/a/SKILL.md', '---\nname: Alpha\ndisable-model-invocation: true\n---\n');
  put('skills/c/SKILL.md', '---\nname: c\n---\n');
  put('skills/nested/x/SKILL.md', '---\nname: x\n---\n');
  put('skills/stray.md', 'x');
  put('settings.json', JSON.stringify({ skillOverrides: { c: 'off', b: 'bogus' } }));
  expect(listSkills(dir)).toEqual([
    { name: 'Alpha', description: '', state: 'user-invocable-only' },
    { name: 'b', description: 'B desc', state: 'on' },
    { name: 'c', description: '', state: 'off' },
  ]);
  expect(listSkills(join(dir, 'none'))).toEqual([]);
});

test('listAgents accepts folders and plain md files', () => {
  put('agents/dev/dev.agent.md', '---\ndescription: Dev\n---\n');
  put('agents/two/a.agent.md', '');
  put('agents/two/b.agent.md', '');
  put('agents/empty/readme.txt', '');
  put('agents/Zed.md', '---\nname: zed\ndescription: Z\n---\n');
  put('agents/stray.txt', '');
  expect(listAgents(dir)).toEqual([
    { name: 'dev', description: 'Dev' },
    { name: 'zed', description: 'Z' },
  ]);
});
