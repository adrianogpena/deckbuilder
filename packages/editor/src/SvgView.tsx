import { PanelBanner, t } from '@deckbuilder/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeView } from './CodeView';


const NAMESPACES: Record<string, string> = {
  inkscape: 'http://www.inkscape.org/namespaces/inkscape',
  sodipodi: 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
  cc: 'http://creativecommons.org/ns#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
};

/** Declares the well-known prefixes a file uses without declaring them (some generators forget `xmlns:inkscape`), so the strict XML parser accepts it. */
export function declareNamespaces(source: string): string {
  const root = /<svg[^>]*>/.exec(source);
  if (!root) return source;
  const missing = Object.keys(NAMESPACES).filter((p) => !root[0].includes(`xmlns:${p}=`) && (source.includes(`<${p}:`) || source.includes(` ${p}:`)));
  if (missing.length === 0) return source;
  const decls = missing.map((p) => ` xmlns:${p}="${NAMESPACES[p]}"`).join('');
  return source.replace(/<svg/, `<svg${decls}`);
}

interface Layer {
  id: number;
  label: string;
}

interface Parsed {
  doc?: Document;
  layers: Layer[];
  error?: string;
}

const isLayer = (el: Element) => el.getAttributeNS(NAMESPACES.inkscape!, 'groupmode') === 'layer';

function parseSvg(source: string): Parsed {
  const doc = new DOMParser().parseFromString(declareNamespaces(source), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) return { layers: [], error: err.textContent?.trim().slice(0, 200) ?? 'parse error' };
  const layers = [...doc.querySelectorAll('g')].filter(isLayer).map((g, id) => ({ id, label: g.getAttributeNS(NAMESPACES.inkscape!, 'label') || g.id || `Layer ${id + 1}` }));
  return { doc, layers };
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

/** What an image view shows, for a status bar: natural size in px (0 until loaded) and zoom (1 = 100 %). */
export interface ImageInfo {
  width: number;
  height: number;
  zoom: number;
}

/** Pointer travel (px) below which a press counts as a click, not a pan. */
const CLICK_SLOP = 4;

/**
 * An SVG drawn by an `<img>` (its scripts never run) with zoom, drag to pan, a background switch and its source.
 * Without `source` it shows any image this way (PNG, JPEG, ...). It opens fitted to the view (never enlarged);
 * a click toggles fit and 100 %; the wheel and +/- (0 fits) zoom while the pointer or focus is on the image.
 */
export function SvgView({ url, source, name, onInfo }: { url: string; source?: string; name: string; onInfo?(info: ImageInfo): void }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [fit, setFit] = useState(true);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [light, setLight] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: number }>();
  const stage = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [showLayers, setShowLayers] = useState(false);
  const parsed = useMemo(() => (source === undefined ? undefined : parseSvg(source)), [source]);
  const [shown, setShown] = useState(url);

  useEffect(() => setHidden(new Set()), [source]);
  // The file as the page shows it: namespaces repaired, hidden layers display:none, drawn by an <img> so its scripts never run.
  useEffect(() => {
    if (!parsed?.doc) {
      setShown(url);
      return;
    }
    const copy = parsed.doc.cloneNode(true) as Document;
    [...copy.querySelectorAll('g')].filter(isLayer).forEach((g, i) => {
      if (hidden.has(i)) g.setAttribute('style', `${g.getAttribute('style') ?? ''};display:none`);
    });
    const blob = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    setShown(blob);
    return () => URL.revokeObjectURL(blob);
  }, [parsed, hidden, url]);

  // An SVG without its own size takes the size of the view.
  const size = natural.w > 0 && natural.h > 0 ? natural : box;
  const fitZoom = size.w > 0 && box.w > 0 ? Math.min(1, box.w / size.w, box.h / size.h) : 1;
  const shownView = fit ? { zoom: fitZoom, x: 0, y: 0 } : view;

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const from = shownView;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.zoom * factor));
    const k = zoom / from.zoom;
    setFit(false);
    setView({ zoom, x: cx - (cx - from.x) * k, y: cy - (cy - from.y) * k });
  };
  const actual = () => {
    setFit(false);
    setView({ zoom: 1, x: 0, y: 0 });
  };
  const toggle = () => (fit ? actual() : setFit(true));

  useEffect(() => {
    onInfo?.({ width: natural.w, height: natural.h, zoom: shownView.zoom });
  }, [natural.w, natural.h, shownView.zoom]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showSource]);

  // A native listener: React's wheel listeners are passive, so they can't stop the page from scrolling or zooming (Ctrl+wheel in a browser tab).
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showSource]);

  return (
    <div className="file-preview">
      <div className="file-preview-bar svg-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.25, 0, 0)} aria-label={t('pdf.zoomOut')} title={t('pdf.zoomOut')}>−</button>
        <span className="svg-zoom">{Math.round(shownView.zoom * 100)}%</span>
        <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.25, 0, 0)} aria-label={t('pdf.zoomIn')} title={t('pdf.zoomIn')}>+</button>
        <button className="btn btn-ghost btn-sm" onClick={toggle}>{fit ? '100%' : t('svg.actual')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setLight(!light)} aria-pressed={light}>{light ? t('svg.bgLight') : t('svg.bgDark')}</button>
        {parsed && parsed.layers.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLayers(!showLayers)} aria-pressed={showLayers}>
            {t('pdf.layers')} ({parsed.layers.length})
          </button>
        )}
        {source !== undefined && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSource(!showSource)} aria-pressed={showSource}>
            {showSource ? t('svg.image') : t('svg.source')}
          </button>
        )}
      </div>
      {parsed?.error && <PanelBanner tone="err" icon="alert">{t('svg.invalid', { message: parsed.error })}</PanelBanner>}
      <div className="file-preview-body svg-body">
        {showSource && source !== undefined ? (
          <CodeView value={source} lang="text" wrap lineNumbers />
        ) : (
          <div
            ref={stage}
            className={`svg-stage${light ? ' svg-light' : ''}`}
            tabIndex={0}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              drag.current = { x: e.clientX, y: e.clientY, moved: d.moved + Math.abs(dx) + Math.abs(dy) };
              if (drag.current.moved < CLICK_SLOP) return;
              const from = shownView;
              setFit(false);
              setView({ ...from, x: from.x + dx, y: from.y + dy });
            }}
            onPointerUp={() => {
              if (drag.current && drag.current.moved < CLICK_SLOP) toggle();
              drag.current = undefined;
            }}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.altKey || e.metaKey) return;
              if (e.key === '+' || e.key === '=') zoomAt(1.25, 0, 0);
              else if (e.key === '-') zoomAt(1 / 1.25, 0, 0);
              else if (e.key === '0') setFit(true);
              else return;
              e.preventDefault();
            }}
          >
            <img
              src={shown}
              alt={name}
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={{
                width: size.w || undefined,
                height: size.h || undefined,
                transform: `translate(-50%, -50%) translate(${shownView.x}px, ${shownView.y}px) scale(${shownView.zoom})`,
              }}
            />
          </div>
        )}
        {showLayers && !showSource && parsed && (
          <div className="pdf-layers">
            {parsed.layers.map((layer) => (
              <label key={layer.id} className="pdf-layer">
                <input
                  type="checkbox"
                  checked={!hidden.has(layer.id)}
                  onChange={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (!next.delete(layer.id)) next.add(layer.id);
                      return next;
                    })
                  }
                />
                <span>{layer.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
