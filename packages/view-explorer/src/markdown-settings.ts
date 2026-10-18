import { MARKDOWN_SETTINGS_DEFAULTS, type MarkdownSettings } from '@deckbuilderkit/editor/markdown-commands';
import { Modal } from '@deckbuilderkit/ui';
import { createElement, Fragment, type ReactElement, useEffect, useMemo, useSyncExternalStore } from 'react';

import { t } from './i18n';
import { markdownStoredOf, type MarkdownStored } from './settings/markdown';

interface Live {
  markdown: MarkdownStored;
  toc: boolean;
}

let live: Live = { markdown: markdownStoredOf(undefined), toc: MARKDOWN_SETTINGS_DEFAULTS.toc };
let inspecting = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const sameSettings = (a: Live, b: Live) => a.toc === b.toc && (Object.keys(a.markdown) as (keyof MarkdownStored)[]).every((k) => a.markdown[k] === b.markdown[k]);

/** The effective markdown settings, live; the table of contents comes from the caller's `files.markdownToc` while the host has not published yet. */
export function useMarkdownSettings(markdownToc = true): MarkdownSettings {
  const stored = useSyncExternalStore(subscribe, () => live);
  return useMemo(() => ({ ...stored.markdown, toc: markdownToc }), [stored, markdownToc]);
}

/** Opens the dialog that lists the effective markdown settings. */
export function inspectMarkdownConfig(): void {
  inspecting = true;
  emit();
}

const ROWS: { key: keyof MarkdownSettings; label: string }[] = [
  { key: 'defaultMode', label: 'settings.explorer.markdownDefaultMode' },
  { key: 'readingWidth', label: 'settings.explorer.markdownReadingWidth' },
  { key: 'zoom', label: 'settings.explorer.markdownZoom' },
  { key: 'mermaid', label: 'settings.explorer.markdownMermaid' },
  { key: 'toc', label: 'settings.explorer.markdownToc' },
];

const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

function Inspector({ onClose }: { onClose: () => void }): ReactElement {
  const state = useSyncExternalStore(subscribe, () => live);
  const effective: MarkdownSettings = { ...state.markdown, toc: state.toc };
  const rows = ROWS.map(({ key, label }) => {
    const same = effective[key] === MARKDOWN_SETTINGS_DEFAULTS[key];
    return createElement(
      'tr',
      { key },
      createElement('td', null, t(label as 'settings.explorer.markdownZoom')),
      createElement('td', { className: 'mono' }, show(effective[key])),
      createElement('td', null, t(same ? 'explorer.md.inspectDefault' : 'explorer.md.inspectChanged')),
    );
  });
  const head = createElement(
    'tr',
    null,
    createElement('th', null, t('explorer.md.inspectSetting')),
    createElement('th', null, t('explorer.md.inspectValue')),
    createElement('th', null),
  );
  const footer = createElement('button', { className: 'btn', onClick: onClose }, t('common.close' as 'explorer.md.inspectTitle'));
  return createElement(
    Modal,
    { title: t('explorer.md.inspectTitle'), onClose, footer },
    createElement('table', { className: 'table' }, createElement('thead', null, head), createElement('tbody', null, rows)),
  );
}

/** Mounted by the Explorer view: publishes the stored settings to `useMarkdownSettings` and renders the inspect dialog. */
export function MarkdownSettingsHost({ markdown, toc }: { markdown: unknown; toc: boolean }): ReactElement {
  const next = useMemo<Live>(() => ({ markdown: markdownStoredOf(markdown), toc }), [markdown, toc]);
  useEffect(() => {
    if (sameSettings(live, next)) return;
    live = next;
    emit();
  }, [next]);
  const open = useSyncExternalStore(subscribe, () => inspecting);
  return createElement(
    Fragment,
    null,
    open &&
      createElement(Inspector, {
        onClose: () => {
          inspecting = false;
          emit();
        },
      }),
  );
}
