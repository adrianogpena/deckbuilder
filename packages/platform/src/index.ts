// OS-specific code lives here, so apps and the other packages stay portable.
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
