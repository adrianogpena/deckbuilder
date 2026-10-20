import type { ReactNode } from 'react';
import type { DialogFilter } from './api';
import type { ChoiceOptions, ConfirmOptions, PromptOptions } from './components/ui';

/** What the mounted `<DialogHost/>` offers; g3 extends it with the file dialogs through `open`. */
export interface DialogHostImpl {
  confirm(opts: ConfirmOptions): Promise<boolean>;
  prompt(opts: PromptOptions): Promise<string | null>;
  choose(opts: ChoiceOptions): Promise<string | null>;
  /** Renders `node` (a modal element) in the host; returns the function that removes it. */
  open(node: ReactNode): () => void;
}

let host: DialogHostImpl | null = null;

/** Called by `<DialogHost/>` on mount; returns the unregister function. */
export function registerDialogHost(impl: DialogHostImpl): () => void {
  host = impl;
  return () => {
    if (host === impl) host = null;
  };
}

function current(): DialogHostImpl {
  if (!host) throw new Error('DialogHost is not mounted');
  return host;
}

const dialog = async (kind: string, opts: object) => {
  const { request } = await import('./api');
  return request<{ path: string | null }>('POST', `/api/dialog/${kind}`, {}, opts).then((r) => r.path);
};

/**
 * Promise-based in-app dialogs, shown by the mounted `<DialogHost/>` (throws when none is mounted).
 * The pick/save functions still use the native dialogs through the app server's `dialogRoutes`; each
 * resolves an absolute path, or null when cancelled.
 */
export const dialogs = {
  confirm: (opts: ConfirmOptions) => current().confirm(opts),
  prompt: (opts: PromptOptions) => current().prompt(opts),
  choose: (opts: ChoiceOptions) => current().choose(opts),
  open: (node: ReactNode) => current().open(node),
  pickFolder: (opts: { title?: string } = {}) => dialog('folder', opts),
  pickFile: (opts: { title?: string; filters?: DialogFilter[] } = {}) => dialog('file', opts),
  saveFileAs: (opts: { title?: string; suggestedName?: string; filters?: DialogFilter[] } = {}) => dialog('save', opts),
};
