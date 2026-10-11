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

/**
 * An SVG drawn by an `<img>` (its scripts never run) with wheel zoom, drag to pan, a background switch and its source.
 * Without `source` it shows any image this way (PNG, JPEG, ...).
 */
export function SvgView({ url, source, name }: { url: string; source?: string; name: string }) {
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [light, setLight] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const drag = useRef<{ x: number; y: number }>();
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

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const reset = () => setView({ zoom: 1, x: 0, y: 0 });

  // A native listener: React's wheel listeners are passive, so they can't stop the page from scrolling or zooming (Ctrl+wheel in a browser tab).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showSource]);

  return (
    <div className="file-preview">
      <div className="file-preview-bar svg-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.25, 0, 0)} aria-label={t('pdf.zoomOut')} title={t('pdf.zoomOut')}>−</button>
        <span className="svg-zoom">{Math.round(view.zoom * 100)}%</span>
        <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.25, 0, 0)} aria-label={t('pdf.zoomIn')} title={t('pdf.zoomIn')}>+</button>
        <button className="btn btn-ghost btn-sm" onClick={reset}>{t('svg.actual')}</button>
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
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              drag.current = { x: e.clientX, y: e.clientY };
              setView((v) => ({ ...v, x: v.x + e.clientX - d.x, y: v.y + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = undefined)}
            onDoubleClick={reset}
          >
            <img src={shown} alt={name} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />
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
