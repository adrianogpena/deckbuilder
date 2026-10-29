import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AgentDetails, AgentLocal, AgentSkill, AgentSkillState } from '../protocol.ts';

const STATES: readonly AgentSkillState[] = ['on', 'name-only', 'user-invocable-only', 'off'];

/** Keys of the block between the first two `---` lines; folded/literal block values join the more-indented lines with spaces. */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return {};
  const block = lines.slice(1, end);
  const out: Record<string, string> = {};
  for (let i = 0; i < block.length; i++) {
    const m = /^([A-Za-z0-9_.-]+):(.*)$/.exec(block[i]!);
    if (!m) continue;
    let value = m[2]!.trim();
    if (/^[>|][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (i + 1 < block.length && /^\s+\S/.test(block[i + 1]!)) parts.push(block[++i]!.trim());
      value = parts.join(' ');
    }
    value = value.replace(/^(["'])(.*)\1$/, '$2').trim();
    if (value) out[m[1]!] = value;
  }
  return out;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const entries = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const byName = (a: { name: string }, b: { name: string }) => {
  const l = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return l !== 0 ? l : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

const DETAIL_KEYS = ['argument-hint', 'allowed-tools', 'tools', 'model'] as const;

/** File, last change and the generic frontmatter keys worth showing in a row's details. */
function detailsOf(file: string, fm: Record<string, string>): AgentDetails {
  let modified = 0;
  try {
    modified = statSync(file).mtimeMs;
  } catch {}
  const fields: Record<string, string> = {};
  for (const k of DETAIL_KEYS) if (fm[k]) fields[k] = fm[k];
  return { file, modified, fields };
}

function overrides(configDir: string): Record<string, unknown> {
  try {
    const o = (JSON.parse(read(join(configDir, 'settings.json'))) as { skillOverrides?: unknown }).skillOverrides;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function listSkills(configDir: string): AgentSkill[] {
  const root = join(configDir, 'skills');
  const over = overrides(configDir);
  const skills: AgentSkill[] = [];
  for (const entry of entries(root)) {
    const dir = join(root, entry);
    const file = join(dir, 'SKILL.md');
    if (!isDir(dir) || !isFile(file)) continue;
    const fm = parseFrontmatter(read(file));
    const name = fm.name || entry;
    const o = over[name];
    const state = STATES.find((s) => s === o) ?? (fm['disable-model-invocation']?.toLowerCase() === 'true' ? 'user-invocable-only' : 'on');
    skills.push({ name, description: fm.description ?? '', state, details: detailsOf(file, fm) });
  }
  return skills.sort(byName);
}

export function listAgents(configDir: string): AgentLocal[] {
  const root = join(configDir, 'agents');
  if (!existsSync(root)) return [];
  const agents: AgentLocal[] = [];
  for (const entry of entries(root)) {
    const p = join(root, entry);
    let file: string | undefined;
    let fallback = entry;
    if (isDir(p)) {
      const found = entries(p).filter((f) => f.endsWith('.agent.md') && isFile(join(p, f)));
      if (found.length !== 1) continue;
      file = join(p, found[0]!);
    } else if (entry.endsWith('.md') && isFile(p)) {
      file = p;
      fallback = entry.replace(/(\.agent)?\.md$/, '');
    } else continue;
    const fm = parseFrontmatter(read(file));
    agents.push({ name: fm.name || fallback, description: fm.description ?? '', details: detailsOf(file, fm) });
  }
  return agents.sort(byName);
}

/** Skills that only belong to the projects under the listed paths (`~/.library/project-skills/map.json`: path -> skill names). */
export const SKILL_MAP_FILE = join(homedir(), '.library', 'project-skills', 'map.json');

const pathKey = (p: string) => {
  const home = p.replace(/^~(?=[\\/]|$)/, homedir()).replace(/^\/([a-z])(?=\/|$)/i, '$1:');
  return resolve(home).toLowerCase();
};
const isUnder = (folder: string, root: string) => {
  const f = pathKey(folder);
  const r = pathKey(root);
  return f === r || f.startsWith(r.endsWith(sep) ? r : r + sep);
};

function readSkillMap(file: string): Record<string, string[]> {
  try {
    const o = JSON.parse(read(file)) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/**
 * What a folder sees: the account's global skills and agents (a skill the map ties to other paths is left out), plus the
 * project's own `.claude/skills` and `.claude/agents`. No folder (a group such as Personal): the global ones only.
 */
export function listScoped(configDir: string, folder: string | undefined, mapFile = SKILL_MAP_FILE): { skills: AgentSkill[]; agents: AgentLocal[] } {
  const map = readSkillMap(mapFile);
  const tied = new Set(Object.values(map).flat());
  const here = new Set(folder ? Object.entries(map).filter(([root]) => isUnder(folder, root)).flatMap(([, names]) => names) : []);
  const skills = listSkills(configDir).filter((s) => !tied.has(s.name) || here.has(s.name));
  const agents = listAgents(configDir);
  if (!folder) return { skills, agents };
  const own = join(folder, '.claude');
  const ownSkills = listSkills(own).map((s): AgentSkill => ({ ...s, source: 'project' }));
  const ownAgents = listAgents(own).map((a): AgentLocal => ({ ...a, source: 'project' }));
  return {
    skills: [...skills.filter((s) => !ownSkills.some((o) => o.name === s.name)), ...ownSkills].sort(byName),
    agents: [...agents.filter((a) => !ownAgents.some((o) => o.name === a.name)), ...ownAgents].sort(byName),
  };
}
