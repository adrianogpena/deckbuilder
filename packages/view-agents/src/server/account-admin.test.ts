import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addAccount, applyShared, deleteAccount, normalizeName, readShared } from './account-admin.ts';
import { detectAccounts, forgetPendingAccount, markPendingAccount } from './accounts.ts';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agents-admin-'));
  const def = join(home, '.claude');
  mkdirSync(join(def, 'skills', 'one'), { recursive: true });
  writeFileSync(join(def, 'skills', 'one', 'SKILL.md'), 'skill');
  mkdirSync(join(def, 'agents'));
  mkdirSync(join(def, 'projects'));
  writeFileSync(join(def, 'CLAUDE.md'), 'rules');
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('normalizeName', () => {
  test('cleans the name to a .claude- folder', () => {
    expect(normalizeName('personal')).toBe('.claude-personal');
    expect(normalizeName(' claude-personal ')).toBe('.claude-personal');
    expect(normalizeName('.claude-personal')).toBe('.claude-personal');
  });
  test('refuses empty, separators and ..', () => {
    for (const bad of ['', '  ', '.', 'claude-', 'a/b', 'a\\b', 'c:x', 'a..b']) expect(normalizeName(bad)).toBeUndefined();
  });
});

describe('addAccount', () => {
  test('creates the folder and links the checked entries that exist', () => {
    const r = addAccount(home, 'work', ['skills', 'agents', 'commands', 'CLAUDE.md']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.folder).toBe('.claude-work');
    const dir = join(home, '.claude-work');
    expect(lstatSync(join(dir, 'skills')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, 'skills', 'one', 'SKILL.md'), 'utf8')).toBe('skill');
    expect(existsSync(join(dir, 'commands'))).toBe(false);
    expect(r.linked + r.skippedDevMode).toBe(3);
    expect(r.skipped).toBe(1);
  });
  test('refuses a bad name or an existing account', () => {
    expect(addAccount(home, 'a/b', [])).toEqual({ ok: false, error: 'invalidName' });
    addAccount(home, 'work', []);
    expect(addAccount(home, '.claude-work', [])).toEqual({ ok: false, error: 'exists' });
  });
  test('a pending account is listed without an email', () => {
    const r = addAccount(home, 'fresh', []);
    if (!r.ok) throw new Error('add failed');
    expect(detectAccounts(home).map((a) => a.id)).toEqual(['.claude']);
    markPendingAccount(r.dir);
    const acc = detectAccounts(home).find((a) => a.id === '.claude-fresh');
    expect(acc).toMatchObject({ label: '.claude-fresh', isDefault: false });
    expect(acc?.email).toBeUndefined();
    forgetPendingAccount(r.dir);
  });
});

describe('shared entries', () => {
  test('reads, links missing and unlinks unwanted, never touching real entries', () => {
    addAccount(home, 'work', ['skills']);
    const dir = join(home, '.claude-work');
    mkdirSync(join(dir, 'agents'));
    expect(readShared(home, '.claude-work')).toEqual({ ok: true, shared: ['skills'] });
    const r = applyShared(home, '.claude-work', ['agents', 'projects', 'plugins']);
    expect(r).toMatchObject({ ok: true, linked: 1, unlinked: 1, skipped: 2 });
    expect(existsSync(join(dir, 'skills'))).toBe(false);
    expect(lstatSync(join(dir, 'agents')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(dir, 'projects')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'one', 'SKILL.md'))).toBe(true);
  });
  test('refuses the default account', () => {
    expect(readShared(home, '.claude')).toEqual({ ok: false, error: 'default' });
    expect(applyShared(home, '.claude', [])).toEqual({ ok: false, error: 'default' });
  });
});

describe('deleteAccount', () => {
  test('removes links first and keeps the shared targets', () => {
    addAccount(home, 'work', ['skills', 'projects']);
    writeFileSync(join(home, '.claude-work', '.claude.json'), '{}');
    expect(deleteAccount(home, '.claude-work')).toMatchObject({ ok: true, folder: '.claude-work' });
    expect(existsSync(join(home, '.claude-work'))).toBe(false);
    expect(readFileSync(join(home, '.claude', 'skills', 'one', 'SKILL.md'), 'utf8')).toBe('skill');
    expect(existsSync(join(home, '.claude', 'projects'))).toBe(true);
  });
  test('never deletes the default account or a path outside home', () => {
    expect(deleteAccount(home, '.claude')).toEqual({ ok: false, error: 'default' });
    expect(deleteAccount(home, '../x')).toEqual({ ok: false, error: 'invalidName' });
    expect(deleteAccount(home, '.claude-gone')).toEqual({ ok: false, error: 'notFound' });
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
  });
});
