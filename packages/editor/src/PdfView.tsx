/// <reference path="./pdf-url.d.ts" />
import { ErrorBanner, errorOf, Icon, PanelLoading, t } from '@deckbuilder/ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import { useEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Layer {
  id: string;
  name: string;
  visible: boolean;
}

type OptionalContent = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;

const ZOOM_STEP = 1.25;

/** A PDF page by page on a canvas, with zoom and a list of the document's layers (optional content) to toggle. */
export function PdfView({ data }: { data: Uint8Array }) {
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<ReturnType<typeof errorOf>>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [layers, setLayers] = useState<Layer[]>([]);
  const [showLayers, setShowLayers] = useState(false);
  const config = useRef<OptionalContent>();
  const [configVersion, setConfigVersion] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // pdf.js transfers the buffer to its worker, so it gets a copy.
    const task = pdfjs.getDocument({ data: data.slice() });
    let cancelled = false;
    setDoc(undefined);
    setError(undefined);
    setPage(1);
    task.promise
      .then(async (loaded) => {
        if (cancelled) return;
        const optional = await loaded.getOptionalContentConfig();
        if (cancelled) return;
        config.current = optional;
        const groups = (optional.getGroups() ?? {}) as Record<string, { name?: string; visible: boolean }>;
        setLayers(Object.entries(groups).map(([id, group]) => ({ id, name: group.name || id, visible: group.visible })));
        setDoc(loaded);
      })
      .catch((err) => !cancelled && setError(errorOf(err)));
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!doc || !canvas.current || !body.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current || !body.current) return;
      const base = p.getViewport({ scale: 1 });
      const scale = zoom === 'fit' ? Math.max(0.2, (body.current.clientWidth - 24) / base.width) : zoom;
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const el = canvas.current;
      el.width = Math.floor(viewport.width * ratio);
      el.height = Math.floor(viewport.height * ratio);
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;
      render = p.render({
        canvasContext: el.getContext('2d')!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        optionalContentConfigPromise: Promise.resolve(config.current!),
      });
      render.promise.catch((err) => {
        if (!cancelled) setError(errorOf(err));
      });
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page, zoom, configVersion]);

  const toggle = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer || !config.current) return;
    config.current.setVisibility(id, !layer.visible);
    // Radio-button groups switch each other off, so the state is read back from the config.
    setLayers((all) => all.map((l) => ({ ...l, visible: (config.current!.getGroup(l.id) as { visible: boolean }).visible })));
    setConfigVersion((v) => v + 1);
  };

  const count = doc?.numPages ?? 0;
  const current = typeof zoom === 'number' ? zoom : 1;

  return (
    <div className="file-preview">
      <div className="file-preview-bar pdf-bar">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} title={t('pdf.prev')} aria-label={t('pdf.prev')}>
          <span className="pdf-prev"><Icon name="chevron" /></span>
        </button>
        <span className="pdf-page">{t('pdf.page', { page, count })}</span>
        <button className="btn btn-ghost btn-sm" disabled={page >= count} onClick={() => setPage(page + 1)} title={t('pdf.next')} aria-label={t('pdf.next')}>
          <Icon name="chevron" />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(current / ZOOM_STEP)} title={t('pdf.zoomOut')} aria-label={t('pdf.zoomOut')}>−</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(current * ZOOM_STEP)} title={t('pdf.zoomIn')} aria-label={t('pdf.zoomIn')}>
          <Icon name="plus" />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom('fit')} aria-pressed={zoom === 'fit'}>{t('pdf.fit')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowLayers(!showLayers)} aria-pressed={showLayers}>
          {t('pdf.layers')}{layers.length > 0 && ` (${layers.length})`}
        </button>
      </div>
      <div className="pdf-main">
        <div className="file-preview-body pdf-body" ref={body}>
          {error ? <ErrorBanner error={error} /> : !doc ? <PanelLoading /> : <canvas ref={canvas} className="pdf-canvas" />}
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
