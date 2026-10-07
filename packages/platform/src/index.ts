import { join } from 'node:path';
import { homedir } from 'node:os';

// OS-specific code lives here, so apps and the other packages stay portable.
export * from './browser.ts';
export * from './exe.ts';
export * from './run.ts';
export * from './win/autostart.ts';
export * from './win/powershell.ts';
export * from './win/protocol.ts';
export * from './win/toast.ts';

/** App data folder `~/.<id>`: outside the install folder, so data survives reinstalls and updates. */
export function appHome(id: string): string {
  return join(homedir(), `.${id}`);
}

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
