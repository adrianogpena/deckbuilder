// webview-bun ships TypeScript source, not .d.ts, so skipLibCheck doesn't cover it and its
// source fails our strict settings. tsconfig.json maps the import here; bun still runs the real package.
// Only the parts the shell uses are declared.
export enum SizeHint {
  NONE = 0,
  MIN = 1,
  MAX = 2,
  FIXED = 3,
}

export interface Size {
  width: number;
  height: number;
  hint: SizeHint;
}

export class Webview {
  constructor(debug?: boolean, size?: Size);
  /** Null when the native webview could not be created. */
  get unsafeHandle(): unknown;
  /** The native window: an HWND on Windows. */
  get unsafeWindowHandle(): import('bun:ffi').Pointer | null;
  set title(title: string);
  set size(size: Size);
  navigate(url: string): void;
  init(source: string): void;
  eval(source: string): void;
  bind(name: string, callback: (...args: any[]) => any): void;
  run(): void;
  destroy(): void;
}
