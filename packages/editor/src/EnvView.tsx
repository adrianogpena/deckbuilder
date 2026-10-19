import { Icon, t } from '@deckbuilderkit/ui';
import { useMemo, useState } from 'react';
import { parseEnv } from './table';

/** A `.env` file as a list of variables with their values hidden until revealed. */
export function EnvView({ text }: { text: string }) {
  const lines = useMemo(() => parseEnv(text), [text]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const keys = lines.flatMap((l) => (l.key ? [l.key] : []));
  const allShown = keys.length > 0 && keys.every((k) => shown.has(k));

  const toggle = (key: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="file-preview">
      <div className="file-preview-bar">
        <button title={allShown ? t('preview.hideAll') : t('preview.revealAll')} className="btn btn-ghost btn-sm" onClick={() => setShown(allShown ? new Set() : new Set(keys))}>
          {allShown ? t('preview.hideAll') : t('preview.revealAll')}
        </button>
      </div>
      <div className="file-preview-body">
        {keys.length === 0 && <div className="archive-empty">{t('preview.empty')}</div>}
        {lines.map((l, i) => l.key === null
          ? (l.raw.trim() ? <div key={i} className="env-row env-comment">{l.raw}</div> : null)
          : (
            <div key={i} className="env-row">
              <span className="env-key">{l.key}</span>
              <span className="env-value">{shown.has(l.key) ? l.value : l.value ? '••••••••' : ''}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle(l.key!)} aria-label={shown.has(l.key) ? t('preview.hide') : t('preview.reveal')} title={shown.has(l.key) ? t('preview.hide') : t('preview.reveal')}>
                <Icon name={shown.has(l.key) ? 'lock' : 'key'} size={14} />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
