import { win32 } from 'node:path';
import { PlatformError } from './errors.ts';
import { runWithTimeout } from './run.ts';

export interface TrashDeps {
  /** Moves one absolute path to the recycle bin. */
  trashOne: (path: string) => Promise<void>;
}

const defaultDeps: TrashDeps = { trashOne };

const failed = (detail?: string) => new PlatformError('trashFailed', "Couldn't move to the Recycle Bin.", detail);
const unavailable = (detail?: string) => new PlatformError('trashUnavailable', 'No recycle bin is available on this system.', detail);

/**
 * Moves the absolute `paths` (files or folders) to the OS recycle bin, one awaited call per path
 * like VS Code. Stops at the first failure; the PlatformError 'trashFailed' (or 'trashUnavailable')
 * lists which paths were and weren't moved. It never falls back to a permanent delete.
 */
export async function moveToTrash(paths: string[], deps = defaultDeps): Promise<void> {
  const moved: string[] = [];
  for (const path of paths) {
    try {
      await deps.trashOne(path);
    } catch (err) {
      const reason = err instanceof PlatformError ? err : failed((err as Error).message);
      if (paths.length === 1) throw reason;
      const notMoved = paths.slice(moved.length);
      const detail = `${reason.detail ?? reason.message}
Moved: ${moved.join(', ') || '(none)'}
Not moved: ${notMoved.join(', ')}`;
      throw reason.code === 'trashUnavailable' ? unavailable(detail) : failed(detail);
    }
    moved.push(path);
  }
}

function trashOne(path: string): Promise<void> {
  if (process.platform === 'win32') return shellTrash(path);
  if (process.platform === 'darwin') {
    const lines = ['on run argv', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', 'end run'];
    return run(['osascript', ...lines.flatMap((line) => ['-e', line]), path]);
  }
  if (process.platform === 'linux') return run(['gio', 'trash', path]);
  throw unavailable();
}

// The shell call runs in this process: a PowerShell child that compiles C# on the fly (csc.exe,
// P/Invoke, a delete) is what behavior-based antivirus flagged as ransomware (HEU_AEGIS_CRYPT).
const FO_DELETE = 3;
const FOF_SILENT = 0x4;
const FOF_NOCONFIRMATION = 0x10;
const FOF_ALLOWUNDO = 0x40;
const FOF_NOERRORUI = 0x400;
const FOF_WANTNUKEWARNING = 0x4000;

let shell32Lib: ReturnType<typeof openShell32> | null = null;

function openShell32() {
  const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
  return dlopen('shell32.dll', { SHFileOperationW: { args: [FFIType.ptr], returns: FFIType.i32 } });
}

function shellTrash(path: string): Promise<void> {
  // SHFileOperation expands wildcards and resolves relative paths against the process cwd.
  if (!win32.isAbsolute(path) || /[*?]/.test(path)) return Promise.reject(failed(`Not an absolute path: ${path}`));
  const { ptr } = require('bun:ffi') as typeof import('bun:ffi');
  const { symbols } = (shell32Lib ??= openShell32());
  const from = Buffer.from(`${path}\0\0`, 'utf16le');
  // SHFILEOPSTRUCTW (x64): hwnd@0, wFunc@8, pFrom@16, pTo@24, fFlags@32, fAnyOperationsAborted@36, hNameMappings@40, lpszProgressTitle@48.
  const op = Buffer.alloc(56);
  op.writeUInt32LE(FO_DELETE, 8);
  op.writeBigUInt64LE(BigInt(ptr(from)), 16);
  op.writeUInt16LE(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING, 32);
  const result = symbols.SHFileOperationW(ptr(op));
  if (result !== 0) return Promise.reject(failed(`SHFileOperation failed with code 0x${result.toString(16)}`));
  if (op.readInt32LE(36) !== 0) return Promise.reject(failed('Cancelled.'));
  return Promise.resolve();
}

async function run(argv: string[]): Promise<void> {
  let result: Awaited<ReturnType<typeof runWithTimeout>>;
  try {
    result = await runWithTimeout(argv, 60_000);
  } catch (err) {
    throw unavailable((err as Error).message);
  }
  if (result.kind === 'timeout') throw failed('Timed out.');
  if (result.code !== 0) throw failed(result.stderr.trim());
}

// `bun packages/platform/src/trash.ts --selftest`: creates a temp file and moves it to the bin.
if (import.meta.main && process.argv.includes('--selftest')) {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(tmpdir(), `kedalion-trash-selftest-${Date.now()}.txt`);
  await Bun.write(file, 'Kedalion trash self-test\n');
  await moveToTrash([file]);
  console.log(`moved to the recycle bin: ${file} (exists now: ${await Bun.file(file).exists()})`);
}
