// The window's own zoom (what Ctrl+wheel used to change), set through WebView2's ICoreWebView2Controller.
// webview-bun 2.4.0 doesn't bind webview_get_native_handle, so the library is opened a second time for it.
import { CFunction, dlopen, FFIType, read, type Pointer } from 'bun:ffi';
// @ts-expect-error a native library imported as a file path, as webview-bun does
import bundledLib from 'webview-bun/build/libwebview.dll' with { type: 'file' };

const BROWSER_CONTROLLER = 2;
/** ICoreWebView2Controller vtable: IUnknown (3), get/put_IsVisible, get/put_Bounds, get_ZoomFactor, put_ZoomFactor. */
const PUT_ZOOM_FACTOR = 8;

/** Sets the zoom of the webview `handle` (webview-bun's `unsafeHandle`); call it on the window's thread. Windows only. */
export function setWebviewZoom(handle: Pointer, factor: number): void {
  if (process.platform !== 'win32' || !Number.isFinite(factor) || factor <= 0) return;
  const lib = dlopen((process.env.WEBVIEW_PATH as string | undefined) ?? (bundledLib as string), {
    webview_get_native_handle: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
  });
  try {
    const controller = lib.symbols.webview_get_native_handle(handle, BROWSER_CONTROLLER);
    if (!controller) return;
    const vtable = read.ptr(controller, 0) as Pointer;
    const putZoomFactor = CFunction({ ptr: read.ptr(vtable, PUT_ZOOM_FACTOR * 8) as Pointer, args: [FFIType.ptr, FFIType.f64], returns: FFIType.i32 });
    putZoomFactor(controller, factor);
  } finally {
    lib.close();
  }
}
