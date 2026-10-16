import { copyText, useToast } from '@deckbuilder/ui';
import { t } from '../i18n';

/** Copies a path to the clipboard and says so in a toast. */
export function useCopyPath(): (path: string) => void {
  const toast = useToast();
  return (path) =>
    void copyText(path).then((ok) => toast(ok ? { message: t('explorer.pathCopied') } : { message: t('explorer.copyFailed'), kind: 'error' }));
}
