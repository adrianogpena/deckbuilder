/// <reference path="./wasm.d.ts" />
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import SevenZip from '7z-wasm';
import wasmFile from '7z-wasm/7zz.wasm' with { type: 'file' };
import { invalid } from '@deckbuilder/server-core';

export interface ArchiveEntry {
  /** `/`-separated path inside the archive. */
  path: string;
  dir: boolean;
  /** Bytes; 0 for folders. */
  size: number;
  /** Epoch ms, or 0 when the archive has none. */
  mtime: number;
  encrypted: boolean;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  /** More entries than `MAX_ENTRIES`: the rest are left out. */
  truncated: boolean;
}

const MAX_ENTRIES = 20_000;
// A .tar.gz lists as one .tar; one this small is unpacked in memory to list the files inside.
const MAX_NESTED_TAR_BYTES = 256_000_000;

let wasm: Promise<ArrayBuffer> | undefined;

async function run(args: string[], mounts: Record<string, string>): Promise<{ out: string[]; err: string[]; code: number }> {
  wasm ??= Bun.file(wasmFile).arrayBuffer();
  const out: string[] = [];
  const err: string[] = [];
  const m = await SevenZip({ wasmBinary: await wasm, print: (s) => out.push(s), printErr: (s) => err.push(s) });
  for (const [point, root] of Object.entries(mounts)) {
    m.FS.mkdir(point);
    m.FS.mount(m.NODEFS, { root }, point);
  }
  let code = 0;
  try {
    m.callMain(args);
  } catch (e) {
    code = (e as { status?: number }).status ?? 1;
  }
  return { out, err, code };
}

/** Parses `7z l -slt -ba`: blocks of `Key = value` lines; the first key's line may carry progress text before it. */
export function parseListing(lines: string[]): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let cur: Record<string, string> = {};
  const flush = () => {
    if (cur.Path !== undefined) {
      const mtime = Date.parse(`${(cur.Modified ?? '').slice(0, 19).replace(' ', 'T')}Z`);
      entries.push({
        path: cur.Path.replaceAll('\\', '/'),
        dir: cur.Folder === '+' || (cur.Attributes ?? '').startsWith('D') || /^d/.test(cur.Attributes ?? ''),
        size: Number(cur.Size) || 0,
        mtime: Number.isNaN(mtime) ? 0 : mtime,
        encrypted: cur.Encrypted === '+',
      });
    }
    cur = {};
  };
  for (const raw of lines) {
    const line = raw.includes('Path = ') ? raw.slice(raw.indexOf('Path = ')) : raw;
    if (line.trim() === '') {
      flush();
      continue;
    }
    const i = line.indexOf(' = ');
    if (i > 0) {
      const key = line.slice(0, i);
      if (key === 'Path' && cur.Path !== undefined) flush();
      cur[key] = line.slice(i + 3);
    }
  }
  flush();
  return entries;
}

async function list(abs: string): Promise<ArchiveEntry[]> {
  const { out, err, code } = await run(['l', '-slt', '-ba', '-bd', `/host/${basename(abs)}`], { '/host': dirname(abs) });
  const entries = parseListing(out);
  if (entries.length === 0 && (code !== 0 || err.length > 0)) {
    throw invalid('badArchive', err.find((l) => l.trim()) ?? 'This file is not a supported archive.');
  }
  return entries;
}

/** Lists an archive (7z, rar, zip, tar, gz, xz, bz2, iso, cab, ...), looking inside a lone .tar as well. */
export async function listArchive(abs: string): Promise<ArchiveListing> {
  let entries = await list(abs);
  const only = entries.length === 1 ? entries[0]! : undefined;
  if (only && !only.dir && /\.tar$/i.test(only.path) && only.size <= MAX_NESTED_TAR_BYTES) {
    const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-arc-'));
    try {
      const { code } = await run(['e', '-y', '-bd', `-o/out`, `/host/${basename(abs)}`], { '/host': dirname(abs), '/out': dir });
      if (code === 0 && (await stat(join(dir, basename(only.path))).catch(() => null))) entries = await list(join(dir, basename(only.path)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES };
}
