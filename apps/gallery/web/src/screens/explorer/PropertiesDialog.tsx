import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText, errorMessage, errorOf, formatBytes, Modal, useToast } from '@deckbuilder/ui';
import { api, type FsDuProgress, type FsInfo } from '../../api';
import { t } from '../../i18n';

const GRID = { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', alignItems: 'center', margin: 0 } as const;
const WRAP = { overflowWrap: 'anywhere', margin: 0 } as const;
const ROW = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const;

const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString());
const sized = (bytes: number) => t('explorer.props.bytes', { size: formatBytes(bytes), bytes: bytes.toLocaleString() });

/** Properties of one Explorer entry; a folder can count its size, a file can show its SHA-256. */
export function PropertiesDialog({ root, path, onClose }: { root: string; path: string; onClose: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<FsInfo>();
  const [error, setError] = useState<string>();
  const [du, setDu] = useState<FsDuProgress>();
  const [counting, setCounting] = useState(false);
  const [hash, setHash] = useState<string>();
  const [hashing, setHashing] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.fsInfo(root, path).then(
      (i) => live && setInfo(i),
      (err) => live && setError(errorMessage(errorOf(err))),
    );
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [root, path]);

  const copy = (text: string) =>
    void copyText(text).then((ok) => toast(ok ? { message: t('explorer.props.copied') } : { message: t('explorer.copyFailed'), kind: 'error' }));

  const count = () => {
    const ac = new AbortController();
    abort.current = ac;
    setCounting(true);
    setDu(undefined);
    api
      .fsDu(root, path, setDu, ac.signal)
      .catch((err) => !ac.signal.aborted && setError(errorMessage(errorOf(err))))
      .finally(() => {
        if (abort.current === ac) setCounting(false);
      });
  };
  const cancel = () => {
    abort.current?.abort();
    abort.current = undefined;
    setCounting(false);
  };

  const hashIt = () => {
    setHashing(true);
    api
      .fsHash(root, path)
      .then((h) => setHash(h.sha256), (err) => setError(errorMessage(errorOf(err))))
      .finally(() => setHashing(false));
  };

  const row = (label: string, value: ReactNode) => (
    <>
      <dt>{label}</dt>
      <dd style={WRAP}>{value}</dd>
    </>
  );

  return (
    <Modal
      title={t('explorer.properties')}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t('explorer.props.close')}
        </button>
      }
    >
      {error && <p className="error">{error}</p>}
      {info && (
        <dl style={GRID}>
          {row(t('explorer.props.name'), info.name)}
          {row(
            t('explorer.props.path'),
            <span style={ROW}>
              <span style={WRAP}>{info.fullPath}</span>
              <button className="btn btn-sm" onClick={() => copy(info.fullPath)}>
                {t('explorer.props.copy')}
              </button>
            </span>,
          )}
          {row(t('explorer.props.type'), t(`explorer.props.${info.type}`))}
          {info.type === 'dir'
            ? row(
                t('explorer.props.size'),
                <span style={ROW}>
                  {du && (
                    <span>
                      {sized(du.bytes)} · {t('explorer.props.contains', { files: du.files.toLocaleString(), dirs: du.dirs.toLocaleString() })}
                      {counting && ` · ${t('explorer.props.counting')}`}
                    </span>
                  )}
                  {counting ? (
                    <button className="btn btn-sm" onClick={cancel}>
                      {t('explorer.props.cancel')}
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={count}>
                      {t('explorer.props.calcSize')}
                    </button>
                  )}
                </span>,
              )
            : row(t('explorer.props.size'), sized(info.size))}
          {row(t('explorer.props.created'), when(info.created))}
          {row(t('explorer.props.modified'), when(info.modified))}
          {row(t('explorer.props.accessed'), when(info.accessed))}
          {row(t('explorer.props.readOnly'), t(info.readOnly ? 'explorer.props.yes' : 'explorer.props.no'))}
          {info.type === 'file' &&
            row(
              t('explorer.props.sha256'),
              <span style={ROW}>
                {hash ? (
                  <>
                    <code style={WRAP}>{hash}</code>
                    <button className="btn btn-sm" onClick={() => copy(hash)}>
                      {t('explorer.props.copy')}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm" disabled={hashing} onClick={hashIt}>
                    {hashing ? t('explorer.props.hashing') : t('explorer.props.sha256')}
                  </button>
                )}
              </span>,
            )}
        </dl>
      )}
    </Modal>
  );
}
