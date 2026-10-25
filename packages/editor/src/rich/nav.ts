import { type Command, Plugin, PluginKey } from '@milkdown/prose/state';
import { $prose, $useKeymap } from '@milkdown/utils';
import { findAnchor, scanHeadings } from '../toc';
import type { RichApi, RichFeature } from './commands';
import { docListeners, NavOverlay, navApis, pickerOpeners, revealHeading } from './HeadingPicker';
import { classifyLink, linkHrefAtCursor, relativeLinkPath } from './navLinks';

/** Follows `href` the way a click on it does; false when it points nowhere followable. */
export function followLink(api: RichApi, href: string): boolean {
  const target = classifyLink(href, api.host.filePath);
  if (!target) return false;
  if (target.kind === 'anchor') {
    const heading = findAnchor(scanHeadings(api.view.state.doc), target.fragment);
    if (heading) revealHeading(api.view, heading.pos);
    return true;
  }
  if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer');
  else api.host.onOpenPath(target.path);
  return true;
}

/** Inserts `[label](path)` at the selection; a selected text becomes the label. */
function insertLink(api: RichApi, label: string, href: string): void {
  const { state } = api.view;
  const type = state.schema.marks.link;
  if (!type) return;
  const selected = state.selection.empty ? '' : state.doc.textBetween(state.selection.from, state.selection.to);
  const node = state.schema.text(selected || label, [type.create({ href })]);
  api.view.dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
  api.view.focus();
}

const navKey = new PluginKey('kedalion.richNav');

/** Ctrl+click on a link follows it; every document change tells the outline. */
const navPlugin = $prose(() => new Plugin({
  key: navKey,
  props: {
    handleClick(view, _pos, event) {
      if (!(event.ctrlKey || event.metaKey)) return false;
      const href = (event.target as HTMLElement | null)?.closest?.('a')?.getAttribute('href');
      const api = navApis.get(view);
      if (!href || !api || !followLink(api, href)) return false;
      event.preventDefault();
      return true;
    },
  },
  view: () => ({
    update(view, prev) {
      if (view.state.doc.eq(prev.doc)) return;
      for (const listener of docListeners.get(view) ?? []) listener();
    },
  }),
}));

/** Enter with the cursor inside a link (no selection) follows it; elsewhere Enter falls through to the list keymap. */
const linkEnter: Command = (state, _dispatch, view) => {
  const href = linkHrefAtCursor(state);
  const api = view && navApis.get(view);
  return !!href && !!api && followLink(api, href);
};

const linkEnterKeymap = $useKeymap('kedalionLinkEnter', {
  LinkEnter: { shortcuts: 'Enter', priority: 200, command: () => linkEnter },
});

/** Navigation: go to heading, outline rail, followable links, insert file link. */
export const navFeature: RichFeature = {
  plugins: [navPlugin, ...linkEnterKeymap],
  handlers: {
    goToHeading: (api) => {
      const open = pickerOpeners.get(api.view);
      open?.();
      return !!open;
    },
    insertFileLink: (api) => {
      void api.host.pickFile().then((path) => {
        if (!path) return;
        insertLink(api, path.split('/').pop() ?? path, relativeLinkPath(api.host.filePath, path));
      });
      return true;
    },
  },
  Overlay: NavOverlay,
};
