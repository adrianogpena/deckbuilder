import type { EditorView } from '@milkdown/prose/view';
import { createElement, lazy, Suspense } from 'react';
import type { ReadingWidth, RichApi, RichFeature } from './commands';

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

/** Clamps to 50-200 and snaps to the 10% step. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom / ZOOM_STEP) * ZOOM_STEP));
}

/** One step up or down from `zoom`. */
export const stepZoom = (zoom: number, dir: 1 | -1): number => clampZoom(clampZoom(zoom) + dir * ZOOM_STEP);

/** The largest step at which content `widest` px wide (at `zoom`) fits `available` px. */
export function fitZoom(zoom: number, widest: number, available: number): number {
  if (!(widest > 0) || !(available > 0)) return clampZoom(zoom);
  const target = Math.floor((zoom * available) / widest / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
}

/** CSS `max-width` for the document column. */
export function readingWidthCss(width: ReadingWidth): string {
  if (width === 'full') return 'none';
  if (typeof width === 'number' && Number.isFinite(width)) return `${Math.min(120, Math.max(40, Math.round(width)))}ch`;
  return '72ch';
}

type Listener = () => void;
interface ZoomStore {
  zoom: number;
  listeners: Set<Listener>;
}
const stores = new WeakMap<EditorView, ZoomStore>();

export function zoomStore(api: RichApi): ZoomStore {
  let s = stores.get(api.view);
  if (!s) {
    s = { zoom: clampZoom(api.host.settings.zoom), listeners: new Set() };
    stores.set(api.view, s);
  }
  return s;
}

/** Applies the zoom and reading width as CSS variables on the pane; no ProseMirror transaction. */
export function applyView(api: RichApi): void {
  const pane = api.view.dom.closest<HTMLElement>('.md-rich');
  if (!pane) return;
  pane.style.setProperty('--md-zoom', String(zoomStore(api).zoom / 100));
  pane.style.setProperty('--md-reading-width', readingWidthCss(api.host.settings.readingWidth));
}

export function setZoom(api: RichApi, zoom: number): void {
  const s = zoomStore(api);
  s.zoom = clampZoom(zoom);
  applyView(api);
  s.listeners.forEach((fn) => fn());
}

export function fitToWidth(api: RichApi): void {
  const s = zoomStore(api);
  const doc = api.view.dom.closest<HTMLElement>('.md-rich-doc');
  if (!doc) return;
  let widest = 0;
  api.view.dom.querySelectorAll<HTMLElement>('table, pre, img').forEach((el) => {
    const w = el instanceof HTMLImageElement ? el.naturalWidth * (s.zoom / 100) : el.scrollWidth;
    if (w > widest) widest = w;
  });
  setZoom(api, widest > 0 ? fitZoom(s.zoom, widest, doc.clientWidth) : 100);
}

const LazyZoom = lazy(() => import('./ZoomControl').then((m) => ({ default: m.ZoomControl })));
const ZoomOverlay = ({ api }: { api: RichApi }) => createElement(Suspense, { fallback: null }, createElement(LazyZoom, { api }));

export const viewFeature: RichFeature = {
  Overlay: ZoomOverlay,
  handlers: {
    zoomIn: (api) => (setZoom(api, stepZoom(zoomStore(api).zoom, 1)), true),
    zoomOut: (api) => (setZoom(api, stepZoom(zoomStore(api).zoom, -1)), true),
    zoomReset: (api) => (setZoom(api, 100), true),
    zoomFit: (api) => (fitToWidth(api), true),
  },
};
