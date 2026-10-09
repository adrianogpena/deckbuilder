import { useState } from 'react';
import { type ImportedRequest, parseImport } from '@deckbuilder/editor';
import { type ApiError, ErrorBanner, errorOf, Modal, tryT } from '@deckbuilder/ui';
import { api } from '../../api';
import { t } from '../../i18n';

export const requestLabel = (r: ImportedRequest) => r.name ?? `${r.draft.method} ${r.draft.url}`;

/** `<code>:<argument>` from the parser → translated text; unknown codes show as they are. */
const warningText = (warning: string) => {
  const colon = warning.indexOf(':');
  const code = colon < 0 ? warning : warning.slice(0, colon);
  return tryT(`rest.import.warn.${code}`, { arg: colon < 0 ? '' : warning.slice(colon + 1) }) ?? warning;
};

interface Props {
  /** One parsed request goes into the editor. */
  onLoad: (request: ImportedRequest) => void;
  /** The chosen requests of a file with several are saved; rejects with the reason to show. */
  onSaveMany: (requests: ImportedRequest[]) => Promise<void>;
  onClose: () => void;
}

export function ImportDialog({ onLoad, onSaveMany, onClose }: Props) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ImportedRequest[]>();
  const [checked, setChecked] = useState<boolean[]>([]);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const parse = (source: string) => {
    setError(undefined);
    setMessage(undefined);
    let requests: ImportedRequest[];
    try {
      requests = parseImport(source);
    } catch {
      requests = [];
    }
    if (requests.length === 0) {
      setParsed(undefined);
      setMessage(t('rest.import.nothing'));
      return;
    }
    if (requests.length === 1) {
      onLoad(requests[0]);
      if (requests[0].warnings.length === 0) {
        onClose();
        return;
      }
    }
    setParsed(requests);
    setChecked(requests.map(() => true));
  };

  const openFile = async () => {
    setError(undefined);
    try {
      const { text: content } = await api.importRequestsFile();
      if (content === null) return;
      setText(content);
      parse(content);
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const saveSelected = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSaveMany(parsed.filter((_, i) => checked[i]));
      onClose();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const several = parsed !== undefined && parsed.length > 1;
  const loadedOne = parsed !== undefined && parsed.length === 1;
  const footer = several ? (
    <>
      <button className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
      <button className="btn btn-primary" disabled={busy || !checked.some(Boolean)} onClick={saveSelected}>
        {t('rest.import.saveSelected')}
      </button>
    </>
  ) : loadedOne ? (
    <button className="btn btn-primary" onClick={onClose}>{t('rest.import.close')}</button>
  ) : (
    <>
      <button className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
      <button className="btn" onClick={openFile}>{t('rest.import.openFile')}</button>
      <button className="btn btn-primary" disabled={text.trim() === ''} onClick={() => parse(text)}>{t('rest.import.parse')}</button>
    </>
  );
  const warnings = parsed?.flatMap((r) => r.warnings.map((w) => (several ? `${requestLabel(r)}: ${warningText(w)}` : warningText(w)))) ?? [];

  return (
    <Modal title={t('rest.import.title')} onClose={onClose} footer={footer}>
      {parsed === undefined && (
        <label className="field">
          <span className="mono-label">{t('rest.import.paste')}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoFocus
            aria-label={t('rest.import.paste')}
          />
        </label>
      )}
      {message && <p className="muted">{message}</p>}
      {loadedOne && <p>{t('rest.import.loaded', { name: requestLabel(parsed[0]) })}</p>}
      {several && (
        <div className="field">
          <span className="mono-label">{t('rest.import.found', { count: parsed.length })}</span>
          {parsed.map((r, i) => (
            <label key={i} className="row">
              <input
                type="checkbox"
                checked={checked[i] ?? false}
                onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))}
              />
              <span>{requestLabel(r)}</span>
            </label>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="field">
          <span className="mono-label">{t('rest.import.warnings')}</span>
          {warnings.map((w, i) => (
            <span key={i} className="muted">{w}</span>
          ))}
        </div>
      )}
      {error && <ErrorBanner error={error} compact />}
    </Modal>
  );
}
