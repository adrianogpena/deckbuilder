import { PlatformError } from './errors.ts';
import { killTree, runWithTimeout } from './run.ts';
import { asciiJson, spawnPowerShell } from './win/powershell.ts';

interface TrashProcess {
  pid: number;
  stdin: { write(data: string): unknown; end(): unknown };
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export interface TrashDeps {
  spawn: (script: string, opts: { stdin: 'pipe'; stdout: 'ignore' }) => TrashProcess;
}

const defaultDeps: TrashDeps = { spawn: spawnPowerShell };

const failed = (detail?: string) => new PlatformError('trashFailed', "Couldn't move to the Recycle Bin.", detail);
const unavailable = (detail?: string) => new PlatformError('trashUnavailable', 'No recycle bin is available on this system.', detail);

/**
 * Moves the absolute `paths` (files or folders) to the OS recycle bin. Rejects with PlatformError
 * 'trashFailed' or 'trashUnavailable'; it never falls back to a permanent delete.
 */
export async function moveToTrash(paths: string[], deps = defaultDeps): Promise<void> {
  if (!paths.length) return;
  if (deps !== defaultDeps || process.platform === 'win32') return windowsTrash(paths, deps);
  if (process.platform === 'darwin') {
    const lines = ['on run argv', 'repeat with p in argv', 'tell application "Finder" to delete (POSIX file p as alias)', 'end repeat', 'end run'];
    return run(['osascript', ...lines.flatMap((line) => ['-e', line]), ...paths]);
  }
  if (process.platform === 'linux') return run(['gio', 'trash', ...paths]);
  throw unavailable();
}

// SHFileOperation instead of Microsoft.VisualBasic's DeleteFile: with OnlyErrorDialogs that one
// sets FOF_NOCONFIRMATION without FOF_WANTNUKEWARNING, so a file that can't be recycled (network
// share, bin full or disabled) is deleted permanently without a word. FOF_WANTNUKEWARNING makes
// the shell ask first; "No" aborts the whole operation.
const TRASH_CS = `
using System;
using System.Runtime.InteropServices;

namespace DeckBuilder {
  public static class Trash {
    const uint FO_DELETE = 3;
    const ushort FOF_SILENT = 0x4;
    const ushort FOF_NOCONFIRMATION = 0x10;
    const ushort FOF_ALLOWUNDO = 0x40;
    const ushort FOF_NOERRORUI = 0x400;
    const ushort FOF_WANTNUKEWARNING = 0x4000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEOPSTRUCT {
      public IntPtr hwnd;
      public uint wFunc;
      public string pFrom;
      public string pTo;
      public ushort fFlags;
      [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
      public IntPtr hNameMappings;
      public string lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHFileOperation(ref SHFILEOPSTRUCT op);

    public static void Run(string[] paths) {
      SHFILEOPSTRUCT op = new SHFILEOPSTRUCT();
      op.wFunc = FO_DELETE;
      op.pFrom = String.Join("\\0", paths) + "\\0";
      op.fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING);
      int result = SHFileOperation(ref op);
      if (result != 0) throw new Exception("SHFileOperation failed with code 0x" + result.ToString("x"));
      if (op.fAnyOperationsAborted) throw new Exception("Cancelled.");
    }
  }
}
`;

/** The PowerShell script; it holds no paths: they arrive as JSON on stdin, so a file name can't inject script. */
export function trashScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$o = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
${TRASH_CS}
'@
[DeckBuilder.Trash]::Run([string[]]@($o.paths))
`;
}

const TIMEOUT_MS = 120_000;

async function windowsTrash(paths: string[], deps: TrashDeps): Promise<void> {
  const proc = deps.spawn(trashScript(), { stdin: 'pipe', stdout: 'ignore' });
  proc.stdin.write(asciiJson({ paths }));
  proc.stdin.end();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS);
  });
  const result = await Promise.race([Promise.all([new Response(proc.stderr).text(), proc.exited]), timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    killTree(proc.pid);
    throw failed('Timed out.');
  }
  const [stderr, code] = result;
  if (code !== 0) throw failed(stderr.trim());
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
  const file = join(tmpdir(), `deckbuilder-trash-selftest-${Date.now()}.txt`);
  await Bun.write(file, 'DeckBuilder trash self-test\n');
  await moveToTrash([file]);
  console.log(`moved to the recycle bin: ${file} (exists now: ${await Bun.file(file).exists()})`);
}
