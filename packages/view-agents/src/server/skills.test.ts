import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgents, listScoped, listSkills, parseFrontmatter } from './skills.ts';

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
  expect(listSkills(dir)).toMatchObject([
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
  expect(listAgents(dir)).toMatchObject([
    { name: 'dev', description: 'Dev' },
    { name: 'zed', description: 'Z' },
  ]);
});

test('listScoped limits mapped skills to their paths and adds the project ones', () => {
  put('acc/skills/free/SKILL.md', '---\ndescription: F\n---\n');
  put('acc/skills/tied/SKILL.md', '---\ndescription: T\n---\n');
  put('proj/.claude/skills/own/SKILL.md', '---\ndescription: O\n---\n');
  put('proj/.claude/agents/helper.md', '---\ndescription: H\n---\n');
  put('map.json', JSON.stringify({ [join(dir, 'proj')]: ['tied'], [join(dir, 'other')]: ['free'] }));
  const names = (r: { skills: { name: string }[] }) => r.skills.map((s) => s.name);
  const acc = join(dir, 'acc');
  const map = join(dir, 'map.json');
  expect(names(listScoped(acc, undefined, map))).toEqual([]);
  expect(names(listScoped(acc, join(dir, 'proj'), map))).toEqual(['own', 'tied']);
  const r = listScoped(acc, join(dir, 'proj'), map);
  expect(r.skills.find((s) => s.name === 'own')?.source).toBe('project');
  expect(r.agents).toMatchObject([{ name: 'helper', description: 'H', source: 'project' }]);
});
