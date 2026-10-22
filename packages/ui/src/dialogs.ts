import { createElement, type ReactNode } from 'react';
import type { DialogFilter } from './api';
import { FileDialog } from './components/FileDialog';
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

export interface PickOptions {
  title?: string;
  filters?: DialogFilter[];
  start?: string;
  /** Names the dialog's remembered folder (and recents); the server keeps one per purpose. */
  purpose?: string;
}

export interface SaveOptions extends PickOptions {
  suggestedName?: string;
}

async function pick(mode: 'open' | 'save' | 'folder', opts: SaveOptions): Promise<string | null> {
  const host = current();
  return new Promise((resolve) => {
    let close = () => {};
    close = host.open(
      createElement(FileDialog, {
        mode,
        ...opts,
        onDone: (path) => {
          close();
          resolve(path);
        },
      }),
    );
  });
}

/**
 * Promise-based in-app dialogs, shown by the mounted `<DialogHost/>` (throws when none is mounted).
 * The pick/save functions open the in-app `FileDialog`; each resolves an absolute path the server
 * already accepted (committed), or null when cancelled.
 */
export const dialogs = {
  confirm: (opts: ConfirmOptions) => current().confirm(opts),
  prompt: (opts: PromptOptions) => current().prompt(opts),
  choose: (opts: ChoiceOptions) => current().choose(opts),
  open: (node: ReactNode) => current().open(node),
  pickFolder: (opts: Omit<PickOptions, 'filters'> = {}) => pick('folder', opts),
  pickFile: (opts: PickOptions = {}) => pick('open', opts),
  saveAs: (opts: SaveOptions = {}) => pick('save', opts),
};
