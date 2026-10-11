// OS-specific code lives here, so apps and the other packages stay portable.
import { basename } from 'node:path';
export * from './browser.ts';
export * from './dialogs.ts';
export * from './editors.ts';
export * from './errors.ts';
export * from './exe.ts';
export * from './files.ts';
export * from './home.ts';
export * from './json-file.ts';
export * from './run.ts';
export * from './secrets.ts';
export * from './theme.ts';
export * from './trash.ts';
export * from './win/autostart.ts';
export * from './win/placement.ts';
export * from './win/powershell.ts';
export * from './win/protocol.ts';
export * from './win/toast.ts';
export * from './win/tray.ts';

/**
 * Reports a fatal error: on stderr, and on Windows also in a message box, because the exe is
 * built without a console. Blocks until the box is closed.
 */
export function showError(title: string, text: string): void {
  console.error(`${title}: ${text}`);
  if (process.platform !== 'win32') return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', {
      MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    const wide = (s: string) => Buffer.from(`${s}\0`, 'utf16le');
    const MB_ICONERROR = 0x10;
    user32.symbols.MessageBoxW(null, wide(text), wide(title), MB_ICONERROR);
    user32.close();
  } catch {
    // stderr above is the fallback
  }
}

/**
 * Shows a native window (an HWND) on Windows; elsewhere a no-op. A process started hidden
 * (`bun run` passes SW_HIDE in its STARTUPINFO) gets that value instead of its first ShowWindow
 * call, so the window a library showed once stays hidden; this second call is honoured.
 */
export function showWindow(hwnd: import('bun:ffi').Pointer | null): void {
  if (process.platform !== 'win32' || !hwnd) return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const user32 = dlopen('user32.dll', {
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    });
    const SW_SHOW = 5;
    user32.symbols.ShowWindow(hwnd, SW_SHOW);
    user32.close();
  } catch {
    // the window stays as the library left it
  }
}

/**
 * Sets a native window's title-bar and taskbar icon (Windows) to the icon embedded in the running
 * exe. The webview library picks its own icon; this makes the exe's `--windows-icon` the one shown.
 * A no-op elsewhere and when running from source (the exe would be bun's).
 */
export function setWindowIconFromExe(hwnd: import('bun:ffi').Pointer | null): void {
  if (process.platform !== 'win32' || !hwnd || /^bun(\.exe)?$/i.test(basename(process.execPath))) return;
  try {
    const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
    const shell32 = dlopen('shell32.dll', {
      ExtractIconExW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    });
    const user32 = dlopen('user32.dll', {
      SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.u64 },
    });
    const large = new BigUint64Array(1);
    const small = new BigUint64Array(1);
    const path = Buffer.from(`${process.execPath}\0`, 'utf16le');
    shell32.symbols.ExtractIconExW(path, 0, large, small, 1);
    const WM_SETICON = 0x80;
    if (small[0]) user32.symbols.SendMessageW(hwnd, WM_SETICON, 0n, small[0]); // ICON_SMALL
    if (large[0]) user32.symbols.SendMessageW(hwnd, WM_SETICON, 1n, large[0]); // ICON_BIG
    shell32.close();
    user32.close();
  } catch {
    // the window keeps the library's icon
  }
}

/** Opens a URL in the default browser; best-effort, failures are ignored. */
export function openExternal(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  const cmd =
    process.platform === 'win32'
      ? ['rundll32', 'url.dll,FileProtocolHandler', url]
      : process.platform === 'darwin'
        ? ['open', url]
        : ['xdg-open', url];
  try {
    Bun.spawn(cmd, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true }).unref();
  } catch {
    // no browser launcher available
  }
}
