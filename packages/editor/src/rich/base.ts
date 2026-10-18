import { t } from '@deckbuilderkit/ui';
import type { MilkdownPlugin } from '@milkdown/ctx';
import { imageSchema } from '@milkdown/preset-commonmark';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $prose, $view } from '@milkdown/utils';
import { imagePolicy } from '../markdown';
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

const changeKey = new PluginKey('deckbuilder.richChange');

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
