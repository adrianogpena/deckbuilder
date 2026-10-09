import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path';
import { moveToTrash, type SaveDialogOptions, saveFileAs, writeFileAtomic } from '@deckbuilder/platform';
import { AppError, forbidden, type Handler, invalid, ndjson, notFound, type Routes, type TailChunk } from '@deckbuilder/server-core';

export type { TailChunk };
import { listArchive } from './archive.ts';
import { isBinary } from './bytes.ts';
import { fromPlatform } from './platform-errors.ts';
import { readSqlite } from './sqlite.ts';

/** A folder the app registered; every file route is confined to one. */
export interface FsRoot {
  id: string;
  /** Absolute path. */
  path: string;
  /** Refuses every write route. */
  readOnly?: boolean;
}

export interface RootedFsOptions {
  /** The registered roots, normally from the app's projects record store. */
  roots: () => Promise<FsRoot[]>;
  /** Most bytes `read` returns; a longer file comes back `truncated`. */
  maxReadBytes?: number;
  /** Moves absolute paths to the recycle bin: `moveToTrash` from platform, a fake in tests. */
  trash?: (paths: string[]) => Promise<void>;
  /** The save dialog: `saveFileAs` from platform, a fake in tests. */
  saveAs?: (opts: SaveDialogOptions) => Promise<string | null>;
}

export interface Resolved {
  root: FsRoot;
  /** The real root joined with the relative path, links not followed. */
  abs: string;
  /** `abs` with every link followed; inside the real root. */
  real: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  /** Bytes; 0 for folders. */
  size: number;
  /** Epoch ms, rounded. */
  mtime: number;
  /** A link whose target is outside the root (or missing); every route but list refuses it. */
  outside?: true;
  /** What a link inside the root points to. */
  target?: 'file' | 'dir';
}

export interface SearchHit {
  /** Relative to the root, `/`-separated. */
  path: string;
  kind: 'file' | 'dir';
  /** 1-based; set on content hits. */
  line?: number;
  text?: string;
}

export interface RootedFs {
  routes: Routes;
  resolve(rootId: string, rel: string, opts?: { mustExist?: boolean }): Promise<Resolved>;
}

const badPath = () => invalid('badPath', 'Invalid path.');
const badRequest = () => invalid('badRequest', 'Invalid request.');
const MAX_DELETE_PATHS = 1000;
const outsideRoot = () => forbidden('outsideRoot', 'This path leads outside the project folder.');
const fileNotFound = () => notFound('fileNotFound', 'File or folder not found.');
const exists = () => invalid('exists', 'A file or folder with this name already exists.');
const notADir = () => invalid('notADir', 'This is not a folder.');
const notAFile = () => invalid('notAFile', 'This is not a file.');

const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const WIN_RESERVED = /[<>"|?*\u0000-\u001f]/;

/**
 * True when `segment` can't be one name in a path: `..`, an alternate data stream (`:`), a
 * trailing dot or space (Windows drops them, so two names would open one file), a Windows device
 * name with or without extension, or a character Windows forbids.
 */
function badSegment(segment: string): boolean {
  if (segment === '..' || segment.includes(':') || segment.includes('\0') || /[. ]$/.test(segment)) return true;
  if (DEVICE.test(segment.split('.')[0]!.trimEnd())) return true;
  return process.platform === 'win32' && WIN_RESERVED.test(segment);
}

/** The segments of a client path: relative, split on `/` and `\`, `.` and empty segments dropped. */
function segmentsOf(rel: unknown): string[] {
  if (typeof rel !== 'string' || rel.includes('\0') || /^[\\/]/.test(rel) || /^[a-zA-Z]:/.test(rel)) throw badPath();
  const segments = rel.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segments.some(badSegment)) throw badPath();
  return segments;
}

const validName = (name: unknown): name is string => typeof name === 'string' && !/[\\/]/.test(name) && segmentsOf(name).length === 1;

const fold = process.platform === 'win32' || process.platform === 'darwin' ? (p: string) => p.toLowerCase() : (p: string) => p;

/** True when the real path `path` is `realRoot` or below it. */
function inside(path: string, realRoot: string): boolean {
  const p = fold(path);
  const base = fold(realRoot);
  return p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException)?.code;
const isMissing = (err: unknown) => errno(err) === 'ENOENT' || errno(err) === 'ENOTDIR';

/**
 * `realRoot` joined with `segments`, every existing link followed: the realpath of the nearest
 * existing ancestor plus the segments below it.
 */
async function realOf(realRoot: string, segments: string[], mustExist: boolean): Promise<string> {
  for (let n = segments.length; n > 0; n--) {
    const p = join(realRoot, ...segments.slice(0, n));
    try {
      return join(await realpath(p), ...segments.slice(n));
    } catch (err) {
      if (errno(err) === 'ELOOP') throw outsideRoot();
      if (!isMissing(err)) throw err;
      // A link whose target is missing exists, but where it points can't be checked.
      if (await present(p)) throw outsideRoot();
      if (mustExist) throw fileNotFound();
    }
  }
  return join(realRoot, ...segments);
}

/** Node fs errors as the AppErrors the UI translates; anything else unchanged. */
function fsError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  switch (errno(err)) {
    case 'ENOENT':
      return fileNotFound();
    case 'EEXIST':
    case 'ENOTEMPTY':
      return exists();
    case 'ENOTDIR':
      return notADir();
    case 'EISDIR':
      return notAFile();
    case 'EXDEV':
      return invalid('crossDevice', "Can't move between drives.");
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return forbidden('accessDenied', 'Access denied, or the file is in use.');
  }
  return err;
}

/** `value` as an integer in `[min, max]`; undefined when absent, `badRequest` otherwise. */
function optionalInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isSafeInteger(n) || n < min || n > max) throw badRequest();
  return n;
}

const present = (path: string) => lstat(path).then(() => true, () => false);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const MAX_RAW_BYTES = 50_000_000;
const MAX_TAIL_BYTES = 20_000_000;
const DEFAULT_TAIL_BYTES = 1_000_000;
const MAX_SAVE_RANGE_BYTES = 200_000_000;
const MAX_SEARCH_HITS = 5000;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_HITS_PER_FILE = 20;
const SKIP_DIRS = new Set(['node_modules', '.git']);

const TEXT = 'text/plain; charset=utf-8';
const RAW_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.txt': TEXT,
  '.md': TEXT,
  '.log': TEXT,
  '.csv': TEXT,
  '.json': TEXT,
};

/**
 * Walks the tree below `start` breadth-first and yields name hits (case-insensitive substring of
 * `q`, and `glob` on the name when given) and, with `content`, lines containing `q` in text files
 * up to 1 MB (`glob` then picks the files). Skips `node_modules`, `.git` and links; returns as soon
 * as `signal` aborts. Exported for the tests.
 */
export async function* searchTree(
  start: { abs: string; rel: string },
  query: { q: string; content: boolean; glob: Bun.Glob | null },
  signal: AbortSignal,
): AsyncGenerator<SearchHit> {
  const q = query.q.toLowerCase();
  const nameMatches = (name: string) => (q === '' || name.toLowerCase().includes(q)) && (!query.glob || query.glob.match(name));
  const queue = [start];
  while (queue.length && !signal.aborted) {
    const dir = queue.shift()!;
    let dirents: Dirent[];
    try {
      dirents = await readdir(dir.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => collator.compare(a.name, b.name));
    for (const d of dirents) {
      if (signal.aborted) return;
      if (d.isSymbolicLink() || SKIP_DIRS.has(d.name) || !(d.isDirectory() || d.isFile())) continue;
      const rel = dir.rel ? `${dir.rel}/${d.name}` : d.name;
      const abs = join(dir.abs, d.name);
      if (nameMatches(d.name)) yield { path: rel, kind: d.isDirectory() ? 'dir' : 'file' };
      if (d.isDirectory()) queue.push({ abs, rel });
      else if (query.content && q !== '' && (!query.glob || query.glob.match(d.name))) {
        for (const hit of await contentHits(abs, q)) {
          if (signal.aborted) return;
          yield { path: rel, kind: 'file', ...hit };
        }
      }
    }
  }
}

/** Up to MAX_HITS_PER_FILE lines of a text file containing `q` (lower-cased); [] for big, binary or unreadable files. */
async function contentHits(file: string, q: string): Promise<Array<{ line: number; text: string }>> {
  try {
    if ((await stat(file)).size > MAX_CONTENT_BYTES) return [];
    const bytes = await Bun.file(file).bytes();
    if (isBinary(bytes)) return [];
    const hits: Array<{ line: number; text: string }> = [];
    const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < MAX_HITS_PER_FILE; i++) {
      const at = lines[i]!.toLowerCase().indexOf(q);
      if (at < 0) continue;
      // Long lines (minified code) are cut to a window around the match.
      const from = Math.max(0, at - 100);
      hits.push({ line: i + 1, text: lines[i]!.slice(from, from + 300).trim() });
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * File routes confined to the roots the app registers. The client only ever sends a root id and a
 * relative path; `resolve` turns them into a real path inside that root or refuses.
 *
 * GET `/api/fs/list|stat|read|raw|archive|search` take `root` and `path` in the query; POST
 * `/api/fs/create|write|rename|move|delete` take them in the JSON body.
 */
export function rootedFs(opts: RootedFsOptions): RootedFs {
  const maxReadBytes = opts.maxReadBytes ?? 5_000_000;
  const trash = opts.trash ?? moveToTrash;
  const saveAs = opts.saveAs ?? saveFileAs;

  async function locate(rootId: unknown, rel: unknown, mustExist = false) {
    const root = typeof rootId === 'string' ? (await opts.roots()).find((r) => r.id === rootId) : undefined;
    if (!root || !isAbsolute(root.path)) throw notFound('rootNotFound', 'This folder is no longer registered or no longer exists.');
    const segments = segmentsOf(rel);
    // A root that is itself a link or junction is fine: its target is the boundary.
    const realRoot = await realpath(root.path).catch(() => {
      throw notFound('rootNotFound', 'This folder is no longer registered or no longer exists.');
    });
    const abs = join(realRoot, ...segments);
    const real = await realOf(realRoot, segments, mustExist);
    if (!inside(real, realRoot)) throw outsideRoot();
    return { root, realRoot, segments, abs, real };
  }

  type Located = Awaited<ReturnType<typeof locate>>;

  /**
   * The entry `loc` names itself, in its real parent folder: a link, not its target, so renaming
   * or deleting a link never touches what it points to. The parent must be inside the root too.
   */
  async function entryPath(loc: Located): Promise<string> {
    if (!loc.segments.length) throw badPath();
    const parent = await realOf(loc.realRoot, loc.segments.slice(0, -1), false);
    if (!inside(parent, loc.realRoot)) throw outsideRoot();
    return join(parent, loc.segments.at(-1)!);
  }

  const writable = (root: FsRoot) => {
    if (root.readOnly) throw forbidden('rootReadOnly', 'This folder is read-only in the app.');
  };

  /** The entry at `path` (a link stays a link; one pointing outside `realRoot` is marked); null when it's gone. */
  async function describe(path: string, name: string, realRoot: string): Promise<FsEntry | null> {
    const st = await lstat(path).catch(() => null);
    if (!st) return null;
    if (!st.isSymbolicLink()) {
      const dir = st.isDirectory();
      return { name, kind: dir ? 'dir' : 'file', size: dir ? 0 : st.size, mtime: Math.round(st.mtimeMs) };
    }
    const target = await realpath(path).catch(() => null);
    const tst = target && inside(target, realRoot) ? await stat(target).catch(() => null) : null;
    if (!tst) return { name, kind: 'link', size: 0, mtime: Math.round(st.mtimeMs), outside: true };
    const dir = tst.isDirectory();
    return { name, kind: 'link', size: dir ? 0 : tst.size, mtime: Math.round(tst.mtimeMs), target: dir ? 'dir' : 'file' };
  }

  async function described(path: string, name: string, realRoot: string): Promise<FsEntry> {
    const entry = await describe(path, name, realRoot);
    if (!entry) throw fileNotFound();
    return entry;
  }

  /** Refuses `to` when another entry has that name; a case-only rename of `from` itself is fine. */
  async function refuseExisting(from: string, to: string): Promise<void> {
    if (fold(from) !== fold(to) && (await present(to))) throw exists();
  }

  const fromQuery = (query: URLSearchParams) => ({ root: query.get('root'), path: query.get('path') ?? '' });
  const body = async (json: () => Promise<unknown>) => (await json()) as Record<string, unknown>;

  // Write routes resolve right before acting and act on the real path. A link swapped in between
  // (by another program writing in the root) can still redirect one operation: that check-then-use
  // window is narrowed, not closed; closing it needs handle-relative calls Node doesn't offer.
  const routes: Routes = {
    'GET /api/fs/list': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const names = await readdir(loc.real);
      const entries = (await Promise.all(names.map((name) => describe(join(loc.real, name), name, loc.realRoot)))).filter(
        (e): e is FsEntry => e !== null,
      );
      const isDir = (e: FsEntry) => e.kind === 'dir' || e.target === 'dir';
      entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || collator.compare(a.name, b.name));
      return { entries };
    },

    'GET /api/fs/stat': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      return described(loc.segments.length ? await entryPath(loc) : loc.realRoot, basename(loc.abs), loc.realRoot);
    },

    'GET /api/fs/read': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const bytes = new Uint8Array(await Bun.file(loc.real).slice(0, maxReadBytes).arrayBuffer());
      const mtime = Math.round(st.mtimeMs);
      if (isBinary(bytes)) return { binary: true, size: st.size, mtime };
      return { text: new TextDecoder().decode(bytes), size: st.size, mtime, truncated: st.size > maxReadBytes };
    },

    'GET /api/fs/tail': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const from = optionalInt(query.get('from'), 0, Number.MAX_SAFE_INTEGER);
      const max = optionalInt(query.get('max'), -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) ?? DEFAULT_TAIL_BYTES;
      const window = Math.min(Math.max(max, 1), MAX_TAIL_BYTES);
      const loc = await locate(root, path, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const { size } = st;
      const mtime = Math.round(st.mtimeMs);
      if (from !== undefined && from > size) {
        const reset: TailChunk = { reset: true, from: size, to: size, size, mtime, text: '' };
        return reset;
      }
      const file = Bun.file(loc.real);
      let start = from ?? Math.max(0, size - window);
      let bytes = new Uint8Array(await file.slice(start, Math.min(size, start + window)).arrayBuffer());
      if (isBinary(bytes)) throw invalid('notText', 'This file is not a text file.');
      if (from === undefined && start > 0) {
        const cut = bytes.indexOf(10);
        if (cut >= 0) {
          start += cut + 1;
          bytes = bytes.subarray(cut + 1);
        }
      }
      const reachesEof = start + bytes.length >= size;
      const lastNl = bytes.lastIndexOf(10);
      const decoder = new TextDecoder();
      const chunk: TailChunk = { from: start, to: start, size, mtime, text: '' };
      if (lastNl < 0 && bytes.length >= window) {
        chunk.to = start + bytes.length;
        chunk.text = decoder.decode(bytes);
      } else {
        chunk.to = start + lastNl + 1;
        chunk.text = decoder.decode(bytes.subarray(0, lastNl + 1));
        if (reachesEof && lastNl + 1 < bytes.length) chunk.partial = decoder.decode(bytes.subarray(lastNl + 1));
      }
      return chunk;
    },

    'POST /api/fs/save-range': async ({ json }) => {
      const b = await body(json);
      if (!Number.isSafeInteger(b.from) || (b.from as number) < 0) throw badRequest();
      const from = b.from as number;
      const loc = await locate(b.root, b.path, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      const size = st.size;
      if (size < from) throw invalid('rangeStale', 'The file is shorter than the bookmark; it was rotated or cleared.');
      if (size - from > MAX_SAVE_RANGE_BYTES) throw invalid('rangeTooLarge', 'The range is too large.');
      const name = basename(loc.real);
      const target = await saveAs({
        suggestedName: `${name.slice(0, name.length - extname(name).length)}-from-${from}.log`,
        filters: [{ name: 'Log', patterns: ['*.log'] }],
      }).catch(fromPlatform);
      if (target === null) return { path: null };
      await writeFileAtomic(target, Bun.file(loc.real).slice(from, size));
      return { path: target, bytes: size - from };
    },

    'GET /api/fs/archive': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      return listArchive(loc.real);
    },

    'GET /api/fs/sqlite': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      if ((await stat(loc.real)).isDirectory()) throw notAFile();
      const offset = Number(query.get('offset') ?? 0);
      try {
        return readSqlite(loc.real, query.get('table'), Number.isFinite(offset) ? offset : 0);
      } catch {
        throw invalid('notSqlite', 'The file is not a readable SQLite database.');
      }
    },

    'GET /api/fs/raw': async ({ query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      const st = await stat(loc.real);
      if (st.isDirectory()) throw notAFile();
      // `limit` returns only the first bytes (the hex view), however large the file.
      const limit = Number(query.get('limit'));
      const head = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
      if (!head && st.size > MAX_RAW_BYTES) throw invalid('fileTooLarge', 'The file is too large to show.');
      return new Response(head ? Bun.file(loc.real).slice(0, head) : Bun.file(loc.real), {
        headers: {
          'Content-Type': RAW_TYPES[extname(loc.real).toLowerCase()] ?? 'application/octet-stream',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
          // Opened as a document (an SVG), the file runs nothing and loads nothing.
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'Cache-Control': 'no-store',
        },
      });
    },

    'GET /api/fs/search': async ({ req, query }) => {
      const { root, path } = fromQuery(query);
      const loc = await locate(root, path, true);
      if (!(await stat(loc.real)).isDirectory()) throw notADir();
      const glob = query.get('glob') ? new Bun.Glob(query.get('glob')!) : null;
      const search = { q: query.get('q') ?? '', content: query.get('content') === '1', glob };
      return ndjson(req, async (emit, signal) => {
        let count = 0;
        for await (const hit of searchTree({ abs: loc.real, rel: loc.segments.join('/') }, search, signal)) {
          await emit(hit);
          if (++count >= MAX_SEARCH_HITS) break;
        }
      });
    },

    'POST /api/fs/create': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path);
      writable(loc.root);
      if (!loc.segments.length) throw exists();
      if ((b.kind !== 'file' && b.kind !== 'dir') || (b.text !== undefined && typeof b.text !== 'string')) throw badRequest();
      await mkdir(dirname(loc.real), { recursive: true });
      if (b.kind === 'dir') await mkdir(loc.real);
      else await writeFile(loc.real, (b.text as string | undefined) ?? '', { flag: 'wx' });
      return described(loc.real, basename(loc.abs), loc.realRoot);
    },

    'POST /api/fs/write': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path);
      writable(loc.root);
      const expected = b.expectedMtime ?? undefined;
      if (typeof b.text !== 'string' || (expected !== undefined && typeof expected !== 'number')) throw badRequest();
      const st = await stat(loc.real).catch((err) => {
        if (isMissing(err)) return null;
        throw err;
      });
      if (st?.isDirectory()) throw notAFile();
      if (expected !== undefined && (!st || Math.round(st.mtimeMs) !== expected)) {
        throw invalid('fileChanged', 'The file was changed on disk since it was opened.');
      }
      if (!st && !(await stat(dirname(loc.real)).then((p) => p.isDirectory(), () => false))) throw fileNotFound();
      await writeFileAtomic(loc.real, b.text);
      return described(loc.real, basename(loc.abs), loc.realRoot);
    },

    'POST /api/fs/rename': async ({ json }) => {
      const b = await body(json);
      const loc = await locate(b.root, b.path, true);
      writable(loc.root);
      if (!validName(b.name)) throw badPath();
      const from = await entryPath(loc);
      const to = join(dirname(from), b.name);
      await refuseExisting(from, to);
      await rename(from, to);
      return described(to, b.name, loc.realRoot);
    },

    'POST /api/fs/move': async ({ json }) => {
      const b = await body(json);
      const src = await locate(b.root, b.from, true);
      const dest = await locate(b.toRoot ?? b.root, b.to);
      writable(src.root);
      writable(dest.root);
      const from = await entryPath(src);
      const to = await entryPath(dest);
      if ((await lstat(from)).isDirectory() && fold(to).startsWith(fold(from) + sep)) {
        throw invalid('moveIntoSelf', "A folder can't be moved into itself.");
      }
      await refuseExisting(from, to);
      // Never copy-then-delete across volumes: that would be a permanent delete without undo.
      await rename(from, to);
      return described(to, basename(to), dest.realRoot);
    },

    'POST /api/fs/delete': async ({ json }) => {
      const b = await body(json);
      if (!Array.isArray(b.paths) || !b.paths.length) throw badRequest();
      // outermost() compares all pairs.
      if (b.paths.length > MAX_DELETE_PATHS) throw invalid('tooManyItems', 'Too many items at once.');
      const located = await Promise.all(b.paths.map((p) => locate(b.root, p, true)));
      writable(located[0]!.root);
      const paths = await Promise.all(located.map(entryPath));
      await trash(outermost(paths)).catch(fromPlatform);
      return { ok: true };
    },
  };

  const guard =
    (handler: Handler): Handler =>
    async (ctx) => {
      try {
        return await handler(ctx);
      } catch (err) {
        throw fsError(err);
      }
    };

  return {
    routes: Object.fromEntries(Object.entries(routes).map(([key, handler]) => [key, guard(handler)])),
    resolve: async (rootId, rel, o = {}) => {
      const { root, abs, real } = await locate(rootId, rel, o.mustExist);
      return { root, abs, real };
    },
  };
}

/** `paths` without duplicates and without paths inside another one (the bin takes the folder with them). */
function outermost(paths: string[]): string[] {
  const folded = paths.map(fold);
  return paths.filter((_, i) => !folded.some((q, j) => (j < i && q === folded[i]) || folded[i]!.startsWith(q + sep)));
}
