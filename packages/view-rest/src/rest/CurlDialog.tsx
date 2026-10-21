import { useState } from 'react';
import { CodeEditor } from '@deckbuilderkit/editor';
import { type ApiError, Button, copyText, dialogs, ErrorBanner, errorOf, Modal } from '@deckbuilderkit/ui';
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
      const target = await dialogs.saveAs({
        title: t('rest.code.save'),
        purpose: 'rest-curl',
        suggestedName: 'request.curl',
        filters: [{ name: 'cURL', patterns: ['*.curl', '*.sh'] }, { name: 'All files', patterns: ['*.*'] }],
      });
      if (target === null) return;
      const { path } = await api.saveCurl(curl, target);
      setSavedPath(path);
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const footer = (
    <>
      <Button onClick={onClose} title={t('rest.import.close')}>{t('rest.import.close')}</Button>
      <Button icon="download" onClick={save} title={t('rest.code.save')}>{t('rest.code.save')}</Button>
      <Button variant="primary" icon="copy" onClick={copy} title={copied ? t('rest.code.copied') : t('rest.code.copy')}>{copied ? t('rest.code.copied') : t('rest.code.copy')}</Button>
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
