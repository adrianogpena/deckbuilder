import { useState } from 'react';
import { CodeEditor } from '@deckbuilderkit/editor';
import { type ApiError, copyText, ErrorBanner, errorOf, Modal } from '@deckbuilderkit/ui';
import { restApi as api } from '../client';
import { t } from '../i18n';

export function CurlDialog({ curl, onClose }: { curl: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const copy = async () => {
    setCopied(await copyText(curl));
  };
  const save = async () => {
    setError(undefined);
    try {
      const { path } = await api.saveCurl(curl);
      if (path) setSavedPath(path);
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const footer = (
    <>
      <button className="btn" onClick={onClose} title={t('rest.import.close')}>{t('rest.import.close')}</button>
      <button className="btn" onClick={save} title={t('rest.code.save')}>{t('rest.code.save')}</button>
      <button className="btn btn-primary" onClick={copy} title={copied ? t('rest.code.copied') : t('rest.code.copy')}>{copied ? t('rest.code.copied') : t('rest.code.copy')}</button>
    </>
  );

  return (
    <Modal title={t('rest.code.title')} onClose={onClose} footer={footer}>
      <CodeEditor value={curl} lang="shell" readOnly height={260} wrap />
      {savedPath && <p className="muted">{t('rest.code.saved', { path: savedPath })}</p>}
      {error && <ErrorBanner error={error} compact />}
    </Modal>
  );
}
