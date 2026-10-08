import { dirname, extname } from 'node:path';
import { PlatformError } from './errors.ts';

// Extensions whose default app shows the file. An allowlist: a denylist misses every script type
// another tool registers (`.py` → py.exe). `.svg`/`.html` open in a browser and run script; macro
// formats (`.docm`, `.xlsm`, `.pptm`) are left out too.
const OPENABLE = new Set(
  [
    '.txt .md .markdown .log .csv .tsv .json .xml .yaml .yml .toml .ini .sql',
    '.pdf .docx .xlsx .pptx .odt .ods .odp',
    '.png .jpg .jpeg .gif .webp .bmp .ico .avif .tif .tiff',
    '.mp3 .wav .ogg .flac .m4a .mp4 .webm .mov .mkv .avi',
    '.zip',
  ].join(' ').split(' '),
);

/** True when `path` is a document, image, media file or zip that `openWithDefault` may open. */
export function isOpenable(path: string): boolean {
  return OPENABLE.has(extname(path).toLowerCase());
}

/**
 * The command that opens `path` with its default app. On Windows the path is quoted and passed
 * verbatim: explorer.exe splits an unquoted command line at commas, so `run.cmd,a.txt` ran `run.cmd`.
 */
export function openArgv(path: string, platform: NodeJS.Platform = process.platform): { argv: string[]; verbatim: boolean } {
  // Windows paths can't contain `"`, so quoting is safe.
  if (platform === 'win32') return { argv: ['explorer.exe', `"${path}"`], verbatim: true };
  return { argv: [platform === 'darwin' ? 'open' : 'xdg-open', path], verbatim: false };
}

// Not hidden: windowsHide starts explorer.exe with SW_HIDE and its window never appears.
export function launch(argv: string[], windowsVerbatimArguments = false): void {
  Bun.spawn(argv, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, windowsVerbatimArguments }).unref();
}

/** Shows the absolute `path` selected in the OS file manager (Linux: opens its folder). */
export async function revealInFolder(path: string): Promise<void> {
  // explorer.exe parses its own command line; Windows paths can't contain `"`, so quoting is safe.
  if (process.platform === 'win32') launch(['explorer.exe', `/select,"${path}"`], true);
  else if (process.platform === 'darwin') launch(['open', '-R', path]);
  else launch(['xdg-open', dirname(path)]);
}

/**
 * Opens the absolute `path` with the OS default app. Rejects with PlatformError 'openRefused'
 * unless `isOpenable(path)`: the app shows files, it never runs them.
 */
export async function openWithDefault(path: string): Promise<void> {
  if (!isOpenable(path)) throw new PlatformError('openRefused', 'This file type is not opened from the app.', path);
  const { argv, verbatim } = openArgv(path);
  launch(argv, verbatim);
}
