import './headingLinks.css';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { copyText } from '@kedalion/ui';
import { tryT } from '@kedalion/ui/i18n';
import { scanHeadings } from '../toc';
import type { RichFeature } from './commands';
import { navApis } from './HeadingPicker';

const LINK_PATH = 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7';
const CHECK_PATH = 'M5 12.5l4.5 4.5L19 7';

function icon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

/** The link button of one heading: a click copies `<file>#<slug>`; the icon turns into a check for a moment. */
function linkButton(view: EditorView, slug: string): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-heading-link';
  btn.contentEditable = 'false';
  const label = tryT('explorer.md.copyHeadingLink') ?? 'Copy link to heading';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.appendChild(icon(LINK_PATH));
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const path = navApis.get(view)?.host.filePath ?? '';
    void copyText(`${path}#${slug}`).then((ok) => {
      if (!ok) return;
      btn.replaceChildren(icon(CHECK_PATH));
      btn.classList.add('md-heading-link-done');
      btn.title = tryT('explorer.md.headingLinkCopied') ?? 'Copied';
      setTimeout(() => {
        btn.replaceChildren(icon(LINK_PATH));
        btn.classList.remove('md-heading-link-done');
        btn.title = label;
      }, 1200);
    });
  });
  return btn;
}

const cache = new WeakMap<Node, DecorationSet>();
const key = new PluginKey('kedalion.headingLinks');

/** A link button widget at the start of every heading; the pane's `md-heading-links` class shows or hides them. */
const headingLinksPlugin = $prose(() => new Plugin({
  key,
  props: {
    decorations(state) {
      let set = cache.get(state.doc);
      if (!set) {
        const decos = scanHeadings(state.doc).map((h) =>
          Decoration.widget(h.pos + 1, (view) => linkButton(view, h.slug), { side: -1, ignoreSelection: true, key: `hl:${h.slug}` }),
        );
        set = DecorationSet.create(state.doc, decos);
        cache.set(state.doc, set);
      }
      return set;
    },
  },
}));

export const headingLinksFeature: RichFeature = { plugins: [headingLinksPlugin] };
