import { PlatformError } from './errors.ts';
import { asciiJson, spawnPowerShell } from './win/powershell.ts';

export interface DialogFilter {
  name: string;
  /** Globs such as `*.md`. */
  patterns: string[];
}

export interface FolderDialogOptions {
  title?: string;
  /** Folder the dialog starts in. */
  start?: string;
}

export interface FileDialogOptions extends FolderDialogOptions {
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  title?: string;
  suggestedName?: string;
  filters?: DialogFilter[];
  /** Folder the dialog starts in. */
  start?: string;
}

export type DialogKind = 'folder' | 'file' | 'save';

interface DialogProcess {
  stdin: { write(data: string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export interface DialogDeps {
  spawn: (script: string, opts: { sta: true; stdin: 'pipe'; stdout: 'pipe' }) => DialogProcess;
}

const defaultDeps: DialogDeps = { spawn: spawnPowerShell };

/** Opens the native folder picker; resolves the chosen absolute path, or null when cancelled. */
export const pickFolder = (opts: FolderDialogOptions = {}, deps = defaultDeps) => openDialog('folder', opts, deps);

/** Opens the native "Open file" dialog; resolves the chosen absolute path, or null when cancelled. */
export const pickFile = (opts: FileDialogOptions = {}, deps = defaultDeps) => openDialog('file', opts, deps);

/** Opens the native "Save as" dialog (asks before overwriting); resolves the absolute path, or null when cancelled. */
export const saveFileAs = (opts: SaveDialogOptions = {}, deps = defaultDeps) => openDialog('save', opts, deps);

interface Request {
  title: string;
  start: string;
  name: string;
  filters: DialogFilter[];
}

const str = (v: unknown, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '');

function request(opts: FileDialogOptions & SaveDialogOptions): Request {
  const filters = (Array.isArray(opts.filters) ? opts.filters : [])
    .slice(0, 20)
    .map((f) => ({
      name: str(f?.name, 100),
      patterns: (Array.isArray(f?.patterns) ? f.patterns : []).map((p) => str(p, 100).replace(/[;|]/g, '')).filter(Boolean).slice(0, 20),
    }))
    .filter((f) => f.patterns.length);
  return { title: str(opts.title, 200), start: str(opts.start), name: str(opts.suggestedName, 260), filters };
}

let busy = false;

async function openDialog(kind: DialogKind, opts: FileDialogOptions & SaveDialogOptions, deps: DialogDeps): Promise<string | null> {
  if (busy) throw new PlatformError('dialogBusy', 'A dialog is already open.');
  busy = true;
  try {
    const req = request(opts);
    if (deps !== defaultDeps || process.platform === 'win32') return await windowsDialog(kind, req, deps);
    if (process.platform === 'darwin') return await macDialog(kind, req);
    return await zenityDialog(kind, req);
  } finally {
    busy = false;
  }
}

// --- Windows ---------------------------------------------------------------------------------

// The COM IFileOpenDialog / IFileSaveDialog (the Vista+ dialogs). Only IFileDialog's own methods
// are called, so both coclasses are used through that one interface. Writes the result as ASCII
// JSON itself: Windows PowerShell's ConvertTo-Json leaves non-ASCII to the console code page.
const DIALOG_CS = `
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace DeckBuilder {
  public static class FileDialog {
    public const uint FOS_OVERWRITEPROMPT = 0x2;
    public const uint FOS_PICKFOLDERS = 0x20;
    public const uint FOS_FORCEFILESYSTEM = 0x40;
    public const uint FOS_PATHMUSTEXIST = 0x800;
    public const uint FOS_FILEMUSTEXIST = 0x1000;
    const uint SIGDN_FILESYSPATH = 0x80058000;
    const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCo {}
    [ComImport, Guid("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B")] class FileSaveDialogCo {}

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FilterSpec {
      [MarshalAs(UnmanagedType.LPWStr)] public string Name;
      [MarshalAs(UnmanagedType.LPWStr)] public string Spec;
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
      [PreserveSig] int Show(IntPtr parent);
      void SetFileTypes(uint cFileTypes, [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] rgFilterSpec);
      void SetFileTypeIndex(uint iFileType);
      void GetFileTypeIndex(out uint piFileType);
      void Advise(IntPtr pfde, out uint pdwCookie);
      void Unadvise(uint dwCookie);
      void SetOptions(uint fos);
      void GetOptions(out uint pfos);
      void SetDefaultFolder(IShellItem psi);
      void SetFolder(IShellItem psi);
      void GetFolder(out IShellItem ppsi);
      void GetCurrentSelection(out IShellItem ppsi);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
      void GetResult(out IShellItem ppsi);
      void AddPlace(IShellItem psi, int fdap);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
      void Close(int hr);
      void SetClientGuid(ref Guid guid);
      void ClearClientData();
      void SetFilter(IntPtr pFilter);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    public static string Run(bool save, uint options, string title, string start, string name, string[] filterNames, string[] filterSpecs) {
      IFileDialog dialog = save ? (IFileDialog)new FileSaveDialogCo() : (IFileDialog)new FileOpenDialogCo();
      try {
        uint current;
        dialog.GetOptions(out current);
        dialog.SetOptions(current | options | FOS_FORCEFILESYSTEM);
        if (!String.IsNullOrEmpty(title)) dialog.SetTitle(title);
        if (!String.IsNullOrEmpty(name)) dialog.SetFileName(name);
        if (!String.IsNullOrEmpty(start)) {
          try {
            IShellItem folder;
            SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
            dialog.SetFolder(folder);
          } catch (Exception) {
            // a start folder that doesn't exist: the dialog opens where it would anyway
          }
        }
        if (filterNames.Length > 0) {
          FilterSpec[] specs = new FilterSpec[filterNames.Length];
          for (int i = 0; i < specs.Length; i++) { specs[i].Name = filterNames[i]; specs[i].Spec = filterSpecs[i]; }
          dialog.SetFileTypes((uint)specs.Length, specs);
        }
        int hr = dialog.Show(GetForegroundWindow());
        if (hr == ERROR_CANCELLED) return Json(null);
        Marshal.ThrowExceptionForHR(hr);
        IShellItem result;
        dialog.GetResult(out result);
        string path;
        result.GetDisplayName(SIGDN_FILESYSPATH, out path);
        return Json(path);
      } finally {
        Marshal.ReleaseComObject(dialog);
      }
    }

    static string Json(string path) {
      if (path == null) return "{\\"path\\":null}";
      StringBuilder sb = new StringBuilder("{\\"path\\":\\"");
      foreach (char c in path) {
        if (c == '"' || c == '\\\\') sb.Append('\\\\').Append(c);
        else if (c < 0x20 || c > 0x7e) sb.Append("\\\\u").Append(((int)c).ToString("x4"));
        else sb.Append(c);
      }
      return sb.Append("\\"}").ToString();
    }
  }
}
`;

const FLAGS: Record<DialogKind, string> = {
  folder: '[DeckBuilder.FileDialog]::FOS_PICKFOLDERS -bor [DeckBuilder.FileDialog]::FOS_PATHMUSTEXIST',
  file: '[DeckBuilder.FileDialog]::FOS_FILEMUSTEXIST -bor [DeckBuilder.FileDialog]::FOS_PATHMUSTEXIST',
  save: '[DeckBuilder.FileDialog]::FOS_OVERWRITEPROMPT -bor [DeckBuilder.FileDialog]::FOS_PATHMUSTEXIST',
};

/**
 * The PowerShell script for one dialog kind. It holds no caller data: the options arrive as JSON
 * on stdin, so a title can't inject script.
 */
export function dialogScript(kind: DialogKind): string {
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$o = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
${DIALOG_CS}
'@
$names = @(); $specs = @()
foreach ($f in @($o.filters)) { if ($f) { $names += [string]$f.name; $specs += (@($f.patterns) -join ';') } }
$json = [DeckBuilder.FileDialog]::Run($${kind === 'save'}, (${FLAGS[kind]}), [string]$o.title, [string]$o.start, [string]$o.name, [string[]]$names, [string[]]$specs)
[Console]::Out.Write($json)
`;
}

async function windowsDialog(kind: DialogKind, req: Request, deps: DialogDeps): Promise<string | null> {
  const proc = deps.spawn(dialogScript(kind), { sta: true, stdin: 'pipe', stdout: 'pipe' });
  proc.stdin.write(asciiJson(req));
  proc.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new PlatformError('dialogFailed', 'The dialog could not be opened.', stderr.trim());
  try {
    const { path } = JSON.parse(stdout) as { path: unknown };
    if (path === null || typeof path === 'string') return path || null;
  } catch {
    // reported below
  }
  throw new PlatformError('dialogFailed', 'The dialog could not be opened.', stdout.trim());
}

// --- Linux and macOS (best-effort, untested) -------------------------------------------------

async function runDialog(argv: string[]): Promise<string | null> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PlatformError('dialogFailed', 'The dialog could not be opened.', (err as Error).message);
  }
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code === 1) return null;
  if (code !== 0) throw new PlatformError('dialogFailed', 'The dialog could not be opened.', stderr.trim());
  return stdout.replace(/\r?\n$/, '') || null;
}

function zenityDialog(kind: DialogKind, req: Request): Promise<string | null> {
  const argv = ['zenity', '--file-selection'];
  if (req.title) argv.push(`--title=${req.title}`);
  if (kind === 'folder') argv.push('--directory');
  if (kind === 'save') argv.push('--save', '--confirm-overwrite');
  const start = kind === 'save' ? req.name : req.start && req.start.replace(/\/?$/, '/');
  if (start) argv.push(`--filename=${start}`);
  for (const f of req.filters) argv.push(`--file-filter=${f.name || f.patterns.join(' ')} | ${f.patterns.join(' ')}`);
  return runDialog(argv);
}

// The AppleScript text is fixed per option set; the values arrive as `argv` of its run handler.
function macDialog(kind: DialogKind, req: Request): Promise<string | null> {
  const args: string[] = [];
  const clauses: string[] = [];
  const arg = (value: string) => {
    args.push(value);
    return `(item ${args.length} of argv)`;
  };
  if (req.title) clauses.push(`with prompt ${arg(req.title)}`);
  if (kind === 'save' && req.name) clauses.push(`default name ${arg(req.name)}`);
  if (kind !== 'save' && req.start) clauses.push(`default location (POSIX file ${arg(req.start)})`);
  const command = { folder: 'choose folder', file: 'choose file', save: 'choose file name' }[kind];
  const lines = ['on run argv', `POSIX path of (${command} ${clauses.join(' ')})`, 'end run'];
  return runDialog(['osascript', ...lines.flatMap((line) => ['-e', line]), '--', ...args]);
}

// `bun packages/platform/src/dialogs.ts --selftest`: opens the folder picker, then "Save as";
// prints each result (null = cancelled).
if (import.meta.main && process.argv.includes('--selftest')) {
  console.log('pickFolder:', await pickFolder({ title: 'DeckBuilder self-test: pick a folder "ção"' }));
  console.log(
    'saveFileAs:',
    await saveFileAs({ title: 'DeckBuilder self-test: save as', suggestedName: 'notes.md', filters: [{ name: 'Markdown', patterns: ['*.md'] }] }),
  );
}
