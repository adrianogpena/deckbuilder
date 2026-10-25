/// <reference path="./pdf-url.d.ts" />
import { Button, ErrorBanner, errorOf, IconButton, PanelLoading, t } from '@kedalion/ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Layer {
  id: string;
  name: string;
  visible: boolean;
}

type OptionalContent = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;

const ZOOM_STEP = 1.25;
const WHEEL_STEP = 1.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Padding of the page column and the gap between pages, in px (matches `.pdf-body` and `.pdf-pages`). */
const PAD = 12;
const GAP = 12;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * A PDF as one scrolling column of pages (each drawn on a canvas once it comes near the view),
 * with a page box to jump to, zoom (buttons and Ctrl+wheel) and a list of the document's layers
 * (optional content) to toggle.
 */
export function PdfView({ data }: { data: Uint8Array }) {
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<Array<{ width: number; height: number }>>([]);
  const [error, setError] = useState<ReturnType<typeof errorOf>>();
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [showLayers, setShowLayers] = useState(false);
  const config = useRef<OptionalContent>();
  const [configVersion, setConfigVersion] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  /** Where the view should be after a wheel zoom re-lays the pages out: the point under the cursor stays put. */
  const anchor = useRef<{ x: number; y: number; k: number }>();

  useEffect(() => {
    // pdf.js transfers the buffer to its worker, so it gets a copy.
    const task = pdfjs.getDocument({ data: data.slice() });
    let cancelled = false;
    setDoc(undefined);
    setError(undefined);
    setPage(1);
    setPageText('1');
    task.promise
      .then(async (loaded) => {
        if (cancelled) return;
        const optional = await loaded.getOptionalContentConfig();
        const pages = await Promise.all(Array.from({ length: loaded.numPages }, (_, i) => loaded.getPage(i + 1)));
        if (cancelled) return;
        config.current = optional;
        const groups = (optional.getGroups() ?? {}) as Record<string, { name?: string; visible: boolean }>;
        setLayers(Object.entries(groups).map(([id, group]) => ({ id, name: group.name || id, visible: group.visible })));
        setSizes(pages.map((p) => {
          const v = p.getViewport({ scale: 1 });
          return { width: v.width, height: v.height };
        }));
        setDoc(loaded);
      })
      .catch((err) => !cancelled && setError(errorOf(err)));
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const widest = sizes.reduce((w, s) => Math.max(w, s.width), 0);
  const scale = zoom === 'fit' ? (widest && bodyWidth ? Math.max(0.2, (bodyWidth - 2 * PAD) / widest) : 1) : zoom;
  const heights = sizes.map((s) => Math.floor(s.height * scale));
  const tops: number[] = [];
  heights.reduce((top, h, i) => ((tops[i] = top), top + h + GAP), PAD);

  // Ctrl+wheel zooms the document instead of scrolling it (or zooming the whole page in a browser tab).
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const from = scaleRef.current;
      const to = clampZoom(from * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
      if (to === from) return;
      const r = el.getBoundingClientRect();
      // Several events can come before the next render: each builds on the last.
      scaleRef.current = to;
      anchor.current = { x: e.clientX - r.left, y: e.clientY - r.top, k: (anchor.current?.k ?? 1) * (to / from) };
      setZoom(to);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const el = body.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = undefined;
    el.scrollLeft = (el.scrollLeft + a.x) * a.k - a.x;
    el.scrollTop = PAD + (el.scrollTop + a.y - PAD) * a.k - a.y;
  }, [scale]);

  const onScroll = () => {
    const el = body.current;
    if (!el || tops.length === 0) return;
    const line = el.scrollTop + el.clientHeight / 3;
    let i = 0;
    while (i + 1 < tops.length && tops[i + 1]! <= line) i++;
    if (i + 1 !== page) {
      setPage(i + 1);
      setPageText(String(i + 1));
    }
  };

  const count = doc?.numPages ?? 0;
  const goTo = (n: number) => {
    const target = Math.min(count, Math.max(1, Math.round(n)));
    setPageText(String(target));
    if (!body.current || !Number.isFinite(target) || target < 1) return;
    body.current.scrollTop = tops[target - 1]! - PAD;
    setPage(target);
  };

  const toggle = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer || !config.current) return;
    config.current.setVisibility(id, !layer.visible);
    // Radio-button groups switch each other off, so the state is read back from the config.
    setLayers((all) => all.map((l) => ({ ...l, visible: (config.current!.getGroup(l.id) as { visible: boolean }).visible })));
    setConfigVersion((v) => v + 1);
  };

  return (
    <div className="file-preview">
      <div className="file-preview-bar pdf-bar">
        <IconButton icon="chevron" className="pdf-prev" disabled={page <= 1} onClick={() => goTo(page - 1)} label={t('pdf.prev')} />
        <input
          className="pdf-page-input"
          value={pageText}
          inputMode="numeric"
          aria-label={t('pdf.goTo')}
          title={t('pdf.goTo')}
          onChange={(e) => setPageText(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && goTo(Number(pageText))}
          onBlur={() => setPageText(String(page))}
          onFocus={(e) => e.target.select()}
        />
        <span className="pdf-page">{t('pdf.of', { count })}</span>
        <IconButton icon="chevron" disabled={page >= count} onClick={() => goTo(page + 1)} label={t('pdf.next')} />
        <Button variant="ghost" size="sm" className="btn-icon" onClick={() => setZoom(clampZoom(scale / ZOOM_STEP))} title={t('pdf.zoomOut')} aria-label={t('pdf.zoomOut')}>−</Button>
        <span className="svg-zoom">{Math.round(scale * 100)}%</span>
        <IconButton icon="plus" onClick={() => setZoom(clampZoom(scale * ZOOM_STEP))} label={t('pdf.zoomIn')} />
        <Button title={t('pdf.fit')} variant="ghost" size="sm" onClick={() => setZoom('fit')} pressed={zoom === 'fit'}>{t('pdf.fit')}</Button>
        <Button title={t('pdf.layers')} variant="ghost" size="sm" onClick={() => setShowLayers(!showLayers)} pressed={showLayers}>
          {t('pdf.layers')}{layers.length > 0 && ` (${layers.length})`}
        </Button>
      </div>
      <div className="pdf-main">
        <div className="file-preview-body pdf-body" ref={body} onScroll={onScroll}>
          {error ? (
            <ErrorBanner error={error} />
          ) : !doc ? (
            <PanelLoading />
          ) : (
            <div className="pdf-pages">
              {sizes.map((s, i) => (
                <PdfPage
                  key={i}
                  doc={doc}
                  number={i + 1}
                  width={Math.floor(s.width * scale)}
                  height={heights[i]!}
                  scale={scale}
                  config={config.current!}
                  configVersion={configVersion}
                  root={body}
                />
              ))}
            </div>
          )}
        </div>
        {showLayers && (
          <div className="pdf-layers">
            {layers.length === 0 && <div className="pdf-layers-empty">{t('pdf.noLayers')}</div>}
            {layers.map((layer) => (
              <label key={layer.id} className="pdf-layer">
                <input type="checkbox" checked={layer.visible} onChange={() => toggle(layer.id)} />
                <span>{layer.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface PageProps {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  height: number;
  scale: number;
  config: OptionalContent;
  configVersion: number;
  root: React.RefObject<HTMLDivElement>;
}

/** One page: a box of the page's size, drawn while it is in or near the view and cleared when far away. */
function PdfPage({ doc, number, width, height, scale, config, configVersion, root }: PageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorOf>>();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), { root: root.current, rootMargin: '100% 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!near) {
      // Frees the bitmap; the box keeps its CSS size.
      el.width = 0;
      el.height = 0;
      return;
    }
    let cancelled = false;
    let render: RenderTask | undefined;
    void doc.getPage(number).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      el.width = Math.floor(viewport.width * ratio);
      el.height = Math.floor(viewport.height * ratio);
      render = p.render({
        canvasContext: el.getContext('2d')!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        optionalContentConfigPromise: Promise.resolve(config),
      });
      render.promise.catch((err) => {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') setError(errorOf(err));
      });
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, number, scale, near, config, configVersion]);

  return (
    <div className="pdf-page-box" style={{ width, height }} data-page={number}>
      <canvas ref={canvas} className="pdf-canvas" style={{ width, height }} />
      {error && <div className="pdf-page-error"><ErrorBanner error={error} compact /></div>}
    </div>
  );
}
