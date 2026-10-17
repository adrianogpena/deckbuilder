import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentLocal, AgentSkill, AgentSkillState } from '../protocol.ts';

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
    skills.push({ name, description: fm.description ?? '', state });
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
    agents.push({ name: fm.name || fallback, description: fm.description ?? '' });
  }
  return agents.sort(byName);
}
