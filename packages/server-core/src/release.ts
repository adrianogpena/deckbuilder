// Release manifest and version helpers, shared by the updater and `deckbase release`.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export const MANIFEST = 'latest.json';

export interface ReleaseFile {
  /** File name next to latest.json; never a path. */
  file: string;
  sha256: string;
}

/** `latest.json` in a release folder, written by `deckbase release`. */
export interface ReleaseManifest {
  version: string;
  /** One commit summary per line, `- ` prefixed. */
  notes: string;
  /** ISO timestamp of the release. */
  date: string;
  /** Executable per platform label (`win-x64`, `linux-arm64`, `mac-arm64`, see platformLabel). */
  files: Record<string, ReleaseFile>;
}

/** The manifest, or null when `json` isn't a valid one. */
export function parseManifest(json: unknown): ReleaseManifest | null {
  if (typeof json !== 'object' || json === null) return null;
  const m = json as Record<string, unknown>;
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) return null;
  if (typeof m.notes !== 'string' || typeof m.date !== 'string') return null;
  if (typeof m.files !== 'object' || m.files === null) return null;
  const files: Record<string, ReleaseFile> = {};
  for (const [label, f] of Object.entries(m.files)) {
    const { file, sha256 } = (f ?? {}) as Record<string, unknown>;
    if (typeof file !== 'string' || !/^[\w.-]+$/.test(file) || file.startsWith('.')) return null;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    files[label] = { file, sha256 };
  }
  return { version: m.version, notes: m.notes, date: m.date, files };
}

/** Label of a platform in release file names and manifests: `win-x64`, `linux-arm64`, `mac-arm64`. */
export function platformLabel(os: string = process.platform, arch: string = process.arch): string {
  const name = os === 'win32' || os === 'windows' ? 'win' : os === 'darwin' ? 'mac' : os;
  return `${name}-${arch}`;
}

export type VersionBump = 'patch' | 'minor' | 'major';

/** `[major, minor, patch]`, or null for anything else (e.g. `dev`). */
export function parseVersion(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `candidate` is a release newer than `current`; any release beats `dev`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  if (!a) return false;
  const b = parseVersion(current) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

export function bumpVersion(version: string, bump: VersionBump): string {
  const v = parseVersion(version);
  if (!v) throw new Error(`not a version: ${version}`);
  const [major, minor, patch] = v;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
