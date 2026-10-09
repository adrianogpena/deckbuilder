import type { Pointer } from 'bun:ffi';

/** Where a window sits when not maximized, plus whether it is maximized. Pixels in virtual-screen coordinates. */
export interface WindowPlacement {
  left: number;
  top: number;
  right: number;
  bottom: number;
  maximized: boolean;
}

// WINDOWPLACEMENT: length, flags, showCmd, ptMinPosition(2), ptMaxPosition(2), rcNormalPosition(4), all 32-bit.
const STRUCT_INTS = 11;
const SW_SHOWNORMAL = 1;
const SW_SHOWMAXIMIZED = 3;
const WPF_RESTORETOMAXIMIZED = 2;

function user32() {
  const { dlopen, FFIType } = require('bun:ffi') as typeof import('bun:ffi');
  return dlopen('user32.dll', {
    GetWindowPlacement: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    SetWindowPlacement: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  });
}

/** Reads a window's placement on Windows; undefined elsewhere or when the call fails. */
export function getWindowPlacement(hwnd: Pointer | null): WindowPlacement | undefined {
  if (process.platform !== 'win32' || !hwnd) return undefined;
  try {
    const { ptr } = require('bun:ffi') as typeof import('bun:ffi');
    const lib = user32();
    const buf = new Int32Array(STRUCT_INTS);
    buf[0] = STRUCT_INTS * 4;
    const ok = lib.symbols.GetWindowPlacement(hwnd, ptr(buf));
    lib.close();
    if (!ok) return undefined;
    const maximized = buf[2] === SW_SHOWMAXIMIZED || (buf[1] & WPF_RESTORETOMAXIMIZED) !== 0;
    return { left: buf[7], top: buf[8], right: buf[9], bottom: buf[10], maximized };
  } catch {
    return undefined;
  }
}

/** Moves and sizes a window (maximizing it if asked). Windows pulls a rectangle on a missing monitor back onto a visible one. */
export function setWindowPlacement(hwnd: Pointer | null, p: WindowPlacement): void {
  if (process.platform !== 'win32' || !hwnd) return;
  try {
    const { ptr } = require('bun:ffi') as typeof import('bun:ffi');
    const lib = user32();
    const buf = new Int32Array(STRUCT_INTS);
    buf[0] = STRUCT_INTS * 4;
    buf[2] = p.maximized ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL;
    buf[7] = p.left;
    buf[8] = p.top;
    buf[9] = p.right;
    buf[10] = p.bottom;
    lib.symbols.SetWindowPlacement(hwnd, ptr(buf));
    lib.close();
  } catch {
    // the window stays where the library put it
  }
}

/** Parses a saved placement; undefined when it isn't a sane rectangle. */
export function parsePlacement(value: unknown): WindowPlacement | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const nums = [v.left, v.top, v.right, v.bottom];
  if (!nums.every((n) => Number.isInteger(n)) || typeof v.maximized !== 'boolean') return undefined;
  const [left, top, right, bottom] = nums as number[];
  if (right - left < 200 || bottom - top < 150) return undefined;
  return { left, top, right, bottom, maximized: v.maximized };
}
