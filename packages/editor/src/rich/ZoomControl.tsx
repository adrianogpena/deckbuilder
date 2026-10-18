import './view.css';
import { createT } from '@deckbuilderkit/ui';
import { useEffect, useReducer } from 'react';
import type { RichApi } from './commands';
import { applyView, setZoom, stepZoom, toggleWide, zoomStore } from './view';

type Label = 'explorer.md.zoomIn' | 'explorer.md.zoomOut' | 'explorer.md.zoomReset' | 'explorer.md.zoomFit' | 'explorer.md.zoomCenter';
/** The labels are registered by the explorer view (`packages/view-explorer/src/i18n.ts`). */
const t = createT<Label>();

/** Compact zoom indicator, bottom right of the pane. */
export function ZoomControl({ api }: { api: RichApi }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const store = zoomStore(api);
  useEffect(() => {
    store.listeners.add(bump);
    return () => void store.listeners.delete(bump);
  }, [store]);
  // Runs on every render so a changed reading width setting applies live.
  useEffect(() => applyView(api));
  const label = store.wide ? 'explorer.md.zoomCenter' : 'explorer.md.zoomFit';
  return (
    <div className="md-zoom" role="group">
      <button type="button" title={t('explorer.md.zoomOut')} aria-label={t('explorer.md.zoomOut')} onClick={() => setZoom(api, stepZoom(store.zoom, -1))}>−</button>
      <button type="button" className="md-zoom-value" title={t('explorer.md.zoomReset')} aria-label={t('explorer.md.zoomReset')} onClick={() => setZoom(api, 100)}>{store.zoom}%</button>
      <button type="button" title={t('explorer.md.zoomIn')} aria-label={t('explorer.md.zoomIn')} onClick={() => setZoom(api, stepZoom(store.zoom, 1))}>+</button>
      <button type="button" aria-pressed={store.wide} title={t(label)} onClick={() => toggleWide(api)}>{t(label)}</button>
    </div>
  );
}
