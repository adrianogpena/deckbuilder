import './view.css';
import { createT } from '@deckbuilderkit/ui';
import { useEffect, useReducer } from 'react';
import type { RichApi } from './commands';
import { applyView, fitToWidth, setZoom, stepZoom, zoomStore } from './view';

type Label = 'explorer.md.zoomIn' | 'explorer.md.zoomOut' | 'explorer.md.zoomReset' | 'explorer.md.zoomFit';
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
  return (
    <div className="md-zoom" role="group">
      <button type="button" title={t('explorer.md.zoomOut')} aria-label={t('explorer.md.zoomOut')} onClick={() => setZoom(api, stepZoom(store.zoom, -1))}>−</button>
      <button type="button" className="md-zoom-value" title={t('explorer.md.zoomReset')} aria-label={t('explorer.md.zoomReset')} onClick={() => setZoom(api, 100)}>{store.zoom}%</button>
      <button type="button" title={t('explorer.md.zoomIn')} aria-label={t('explorer.md.zoomIn')} onClick={() => setZoom(api, stepZoom(store.zoom, 1))}>+</button>
      <button type="button" title={t('explorer.md.zoomFit')} onClick={() => fitToWidth(api)}>{t('explorer.md.zoomFit')}</button>
    </div>
  );
}
