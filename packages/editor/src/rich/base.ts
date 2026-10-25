import { t } from '@kedalion/ui';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { htmlSchema, imageSchema } from '@milkdown/preset-commonmark';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $prose, $view } from '@milkdown/utils';
import { imagePolicy, sanitizeHtml } from '../markdown';
import { isUserEdit } from './frontmatter';

/** Images go through `imagePolicy`: relative ones via `resolveImage`, remote ones become a "blocked" placeholder. */
export function imageView(resolveImage: () => ((src: string) => string | null) | undefined): MilkdownPlugin {
  return $view(imageSchema.node, () => (node) => {
    const raw = String(node.attrs.src ?? '');
    const src = imagePolicy(raw, resolveImage());
    let dom: HTMLElement;
    if (src === 'blocked') {
      dom = document.createElement('span');
      dom.className = 'md-img-blocked';
      dom.title = raw;
      dom.textContent = t('preview.remoteImageBlocked');
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = String(node.attrs.alt ?? '');
      if (node.attrs.title) img.title = String(node.attrs.title);
      dom = img;
    }
    return { dom, update: () => false };
  });
}

/** Raw HTML in the text (`<p align="center">…`) shows rendered, sanitized like the read-only view; the node itself stays an atom. */
export function htmlView(resolveImage: () => ((src: string) => string | null) | undefined): MilkdownPlugin {
  return $view(htmlSchema.node, () => (node) => {
    const dom = document.createElement('span');
    dom.className = 'md-html';
    dom.dataset.html = String(node.attrs.value ?? '');
    renderHtml(dom, resolveImage());
    return { dom, update: () => false };
  });
}

function renderHtml(dom: HTMLElement, resolveImage?: (src: string) => string | null) {
  dom.replaceChildren(sanitizeHtml(dom.dataset.html ?? '', { resolveImage, blockedLabel: t('preview.remoteImageBlocked') }));
}

/** Renders the HTML blocks under `root` again; image sources load late, so their blobs arrive after the first render. */
export function refreshHtml(root: HTMLElement, resolveImage?: (src: string) => string | null) {
  for (const el of root.querySelectorAll<HTMLElement>('.md-html')) renderHtml(el, resolveImage);
}

const changeKey = new PluginKey('kedalion.richChange');

/** Calls `onUserEdit` once per view update that follows a user transaction with a document change. */
export function userEditPlugin(onUserEdit: (view: EditorView) => void): MilkdownPlugin {
  let pending = false;
  return $prose(() => new Plugin({
    key: changeKey,
    appendTransaction(trs) {
      if (isUserEdit(trs)) pending = true;
      return null;
    },
    view: () => ({
      update(view) {
        if (!pending) return;
        pending = false;
        onUserEdit(view);
      },
    }),
  }));
}
