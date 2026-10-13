import { formatBytes, PanelBanner, t } from '@deckbuilder/ui';
import { useMemo } from 'react';
import { hexRows } from './table';

/** Bytes the hex view asks for; a longer file shows only its start. */
export const HEX_LIMIT = 64 * 1024;

/** A hex dump: offset, 16 bytes in hex and their printable characters. */
export function HexView({ bytes }: { bytes: Uint8Array }) {
  const rows = useMemo(() => hexRows(bytes), [bytes]);
  return (
    <div className="file-preview">
      {bytes.length >= HEX_LIMIT && <PanelBanner tone="warn" icon="alert">{t('preview.hexCapped', { size: formatBytes(HEX_LIMIT) })}</PanelBanner>}
      <div className="file-preview-bar archive-bar"><span className="archive-summary">{formatBytes(bytes.length)}</span></div>
      <div className="file-preview-body">
        <pre className="hex-view">
          {rows.map((r) => (
            <div key={r.offset} className="hex-row">
              <span className="hex-offset">{r.offset}</span>
              <span className="hex-bytes">{r.hex}</span>
              <span className="hex-ascii">{r.ascii}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
