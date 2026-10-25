import { PanelBanner, t } from '@kedalion/ui';
import { useEffect, useState } from 'react';

const SIZES = [12, 16, 24, 36, 56];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 !?&@#$%(){}[]';

let counter = 0;

/** A font file shown at several sizes with editable sample text. */
export function FontView({ data }: { data: Uint8Array }) {
  const [family, setFamily] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [sample, setSample] = useState(() => t('preview.fontDefault'));

  useEffect(() => {
    let alive = true;
    const name = `kedalion-preview-${++counter}`;
    const face = new FontFace(name, data.slice().buffer);
    setFamily(undefined);
    setFailed(false);
    face.load().then(
      (loaded) => {
        if (!alive) return;
        document.fonts.add(loaded);
        setFamily(name);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      document.fonts.delete(face);
    };
  }, [data]);

  if (failed) return <PanelBanner tone="err" icon="alert">{t('preview.fontError')}</PanelBanner>;
  if (!family) return null;
  return (
    <div className="file-preview">
      <div className="file-preview-bar archive-bar">
        <input className="input font-sample-input" value={sample} onChange={(e) => setSample(e.target.value)} placeholder={t('preview.fontSample')} aria-label={t('preview.fontSample')} />
      </div>
      <div className="file-preview-body font-view" style={{ fontFamily: `"${family}", sans-serif` }}>
        <pre className="font-alphabet">{ALPHABET}</pre>
        {SIZES.map((px) => <div key={px} className="font-line" style={{ fontSize: px }}><span className="font-size">{px}</span>{sample}</div>)}
      </div>
    </div>
  );
}
