import type { DialogFilter } from './api';

export interface PathSegment {
  label: string;
  path: string;
}

const WIN_DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;
const UNC = /^\\\\[^\\/]+[\\/][^\\/]+/;

/** True for `C:\x`, `\\server\share` and `/x`. */
export function isAbsolutePath(path: string): boolean {
  return WIN_DRIVE.test(path) || UNC.test(path) || path.startsWith('/');
}

const isWindows = (path: string) => WIN_DRIVE.test(path) || path.startsWith('\\\\');
const sepOf = (path: string) => (isWindows(path) ? '\\' : '/');

/** The root of an absolute path (`C:\`, `\\server\share`, `/`), or '' for a relative one. */
function rootOf(path: string): string {
  if (WIN_DRIVE.test(path)) return `${path.slice(0, 2)}\\`;
  const unc = UNC.exec(path);
  if (unc) return unc[0].replace(/\//g, '\\');
  return path.startsWith('/') ? '/' : '';
}

/** Breadcrumb segments from the root down: `C:\a\b` → `C:\`, `a`, `b` (each with its full path). */
export function splitPath(path: string): PathSegment[] {
  const root = rootOf(path);
  if (!root) return [];
  const sep = sepOf(path);
  const rest = path.slice(root.length).split(/[\\/]+/).filter(Boolean);
  const out: PathSegment[] = [{ label: root, path: root }];
  let current = root;
  for (const part of rest) {
    current = current.endsWith(sep) ? current + part : current + sep + part;
    out.push({ label: part, path: current });
  }
  return out;
}

/** `base` + `name` with the separator of `base`. */
export function joinPath(base: string, name: string): string {
  const sep = sepOf(base);
  return base.endsWith('/') || base.endsWith('\\') ? base + name : base + sep + name;
}

/** The folder above `path`, or null at a root. */
export function parentPath(path: string): string | null {
  const segments = splitPath(path);
  return segments.length > 1 ? segments[segments.length - 2]!.path : null;
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

/** True when `name` matches a glob of `patterns` (case-insensitive; `*.*` and no patterns match everything). */
export function matchesPatterns(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((p) => p === '*.*' || p === '*' || globToRegExp(p).test(name));
}

/** `name` with the extension of the filter's first plain pattern (`*.md`) added when it has none. */
export function withFilterExtension(name: string, filter: DialogFilter | undefined): string {
  if (!name || /\.[^.\\/]+$/.test(name)) return name;
  const pattern = filter?.patterns.find((p) => /^\*\.[A-Za-z0-9_-]+$/.test(p));
  return pattern ? name + pattern.slice(1) : name;
}

const BAD_NAME = /[/\\:*?"<>|\0-\x1f]/;

/** True for a name a folder or file can have (same rule as the server's mkdir). */
export function isValidFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== '' && trimmed !== '.' && trimmed !== '..' && !BAD_NAME.test(trimmed);
}
