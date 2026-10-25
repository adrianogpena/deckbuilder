import { basename } from 'node:path';

/** True inside a `bun build --compile` exe, false when running from source with bun. */
export function isCompiledExe(execPath = process.execPath): boolean {
  return !/^(bun|node)(\.exe)?$/i.test(basename(execPath));
}
