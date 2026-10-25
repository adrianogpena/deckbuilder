/// <reference path="./wasm.d.ts" />
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import SevenZip from '7z-wasm';
import wasmFile from '7z-wasm/7zz.wasm' with { type: 'file' };
import { invalid } from '@kedalion/server-core';

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

export interface SevenZipJob {
  args: string[];
  /** Emscripten mount point -> host folder, mounted through NODEFS. */
  mounts: Record<string, string>;
  cwd?: string;
}

export interface SevenZipResult {
  out: string[];
  err: string[];
  code: number;
}

/**
 * Runs 7z. With `maxPaths`, stdout stops being kept once it holds that many `Path = ` lines (a
 * listing's entries), so a huge archive can't fill memory; `capped` then says more were printed.
 */
export async function run(args: string[], mounts: Record<string, string>, cwd?: string, maxPaths?: number): Promise<SevenZipResult & { capped?: boolean }> {
  wasm ??= Bun.file(wasmFile).arrayBuffer();
  const out: string[] = [];
  const err: string[] = [];
  let paths = 0;
  let capped = false;
  const print = (s: string) => {
    if (capped) return;
    if (maxPaths !== undefined && s.includes('Path = ') && ++paths > maxPaths) {
      capped = true;
      return;
    }
    out.push(s);
  };
  const m = await SevenZip({ wasmBinary: await wasm, print, printErr: (s) => { if (err.length < 1000) err.push(s); } });
  for (const [point, root] of Object.entries(mounts)) {
    m.FS.mkdir(point);
    m.FS.mount(m.NODEFS, { root }, point);
  }
  if (cwd) m.FS.chdir(cwd);
  let code = 0;
  // The emscripten runtime copies 7z's exit status into process.exitCode; keep the host's own.
  const hostExitCode = process.exitCode;
  try {
    m.callMain(args);
  } catch (e) {
    code = (e as { status?: number }).status ?? 1;
  } finally {
    process.exitCode = hostExitCode;
  }
  return capped ? { out, err, code, capped } : { out, err, code };
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

async function list(abs: string, extra: string[] = [], max = MAX_ENTRIES): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const { out, err, code, capped } = await run(['l', '-slt', '-ba', '-bd', ...extra, `/host/${basename(abs)}`], { '/host': dirname(abs) }, undefined, Number.isFinite(max) ? max : undefined);
  const entries = parseListing(out);
  if (entries.length === 0 && (code !== 0 || err.length > 0)) {
    throw invalid('badArchive', err.find((l) => l.trim()) ?? 'This file is not a supported archive.');
  }
  return { entries: entries.slice(0, max), truncated: capped === true || entries.length > max };
}

/** Lists an archive (7z, rar, zip, tar, gz, xz, bz2, iso, cab, ...), looking inside a lone .tar as well. */
export async function listArchive(abs: string): Promise<ArchiveListing> {
  let listing = await list(abs);
  const { entries } = listing;
  const only = entries.length === 1 ? entries[0]! : undefined;
  if (only && !only.dir && /\.tar$/i.test(only.path) && only.size <= MAX_NESTED_TAR_BYTES) {
    const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-arc-'));
    try {
      const { code } = await run(['e', '-y', '-bd', `-o/out`, `/host/${basename(abs)}`], { '/host': dirname(abs), '/out': dir });
      if (code === 0 && (await stat(join(dir, basename(only.path))).catch(() => null))) listing = await list(join(dir, basename(only.path)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return listing;
}

/**
 * `callMain` is synchronous and blocks its thread for the whole run, so extract and compress run
 * 7z in a Worker; the server keeps answering meanwhile.
 */
function runInWorker(job: SevenZipJob): Promise<SevenZipResult> {
  // In the exe this resolves next to the bundled entry, where `deckbuilder build` must put the worker entrypoint.
  const worker = new Worker(new URL('./archive-worker.ts', import.meta.url).href);
  return new Promise<SevenZipResult>((resolve, reject) => {
    worker.addEventListener('message', (e: MessageEvent<SevenZipResult | { error: string }>) => {
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data);
    });
    worker.addEventListener('error', (e) => reject(new Error(e.message)));
    worker.postMessage(job);
  }).finally(() => worker.terminate());
}

// 7z asks for a password on stdin when it needs one; a dummy one makes it fail instead.
const NO_PASSWORD = '-pdeckbuilder-no-password';
const encrypted = () => invalid('archiveEncrypted', 'The archive is encrypted; password-protected archives are not supported.');
const wrongPassword = (lines: string[]) => lines.some((l) => /wrong password|encrypted|can ?not open encrypted/i.test(l));

const unsafe = () => invalid('archiveUnsafe', 'The archive has entries that lead outside the target folder.');
/** An entry name that climbs out (`..`) or is absolute; 7z would quietly strip that, so it is refused instead. */
const unsafePath = (path: string) => /^([\\/]|[a-zA-Z]:)/.test(path) || path.split(/[\\/]/).includes('..');

/** 7z's exit status isn't passed back by `callMain`, so errors are read from its output too. */
function check(r: SevenZipResult): void {
  const lines = [...r.err, ...r.out];
  if (r.code === 0 && !lines.some((l) => /ERROR|Errors:/.test(l))) return;
  if (wrongPassword(lines)) throw encrypted();
  if (lines.some((l) => /dangerous (link )?path/i.test(l))) throw unsafe();
  throw invalid('badArchive', lines.find((l) => /ERROR/.test(l))?.trim() ?? r.err.find((l) => l.trim()) ?? 'The archive could not be extracted.');
}

/** Lists `abs` for extraction: encrypted entries or entry names leading out are refused. */
async function checkedList(abs: string): Promise<ArchiveEntry[]> {
  // Uncapped: every entry must pass the checks before extracting.
  const { entries } = await list(abs, [NO_PASSWORD], Infinity).catch((err) => {
    throw wrongPassword([(err as Error).message ?? '']) ? encrypted() : err;
  });
  if (entries.some((e) => e.encrypted)) throw encrypted();
  if (entries.some((e) => unsafePath(e.path))) throw unsafe();
  return entries;
}

const extract = (archive: string, to: string, mode: 'x' | 'e' = 'x') =>
  runInWorker({ args: [mode, '-y', '-bd', NO_PASSWORD, '-o/out', `/host/${basename(archive)}`], mounts: { '/host': dirname(archive), '/out': to } }).then(check);

/**
 * Extracts `abs` into the existing empty folder `to` (7z `x`, folders kept). A lone .tar inside a
 * .gz/.xz/.bz2 is unpacked too, like `listArchive` lists it. Encrypted archives and entries that
 * lead out of `to` (`..`, absolute names, links out) are refused.
 */
export async function extractArchive(abs: string, to: string): Promise<void> {
  const entries = await checkedList(abs);
  const only = entries.length === 1 ? entries[0]! : undefined;
  if (only && !only.dir && /\.tar$/i.test(only.path)) {
    const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-arc-'));
    try {
      await extract(abs, dir, 'e');
      const tar = join(dir, basename(only.path));
      await checkedList(tar);
      await extract(tar, to);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return;
  }
  await extract(abs, to);
}

/**
 * Writes the archive `file` (zip or 7z) of the entries `names` of the folder `dir`, stored by name.
 * Links are stored as links (`-snl`), never followed.
 */
export async function compressArchive(dir: string, names: string[], file: string, format: 'zip' | '7z'): Promise<void> {
  const r = await runInWorker({
    args: ['a', `-t${format}`, '-snl', '-bd', '-y', `/out/${basename(file)}`, '--', ...names],
    mounts: { '/host': dir, '/out': dirname(file) },
    cwd: '/host',
  });
  if (r.code !== 0) throw invalid('compressFailed', r.err.find((l) => l.trim()) ?? 'The archive could not be written.');
}
