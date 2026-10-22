import './lineNumbers.css';
import { remarkCtx } from '@milkdown/core';
import type { Node } from '@milkdown/prose/model';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import type { RichFeature } from './commands';
import { splitFrontmatter } from './frontmatter';
import { navApis } from './HeadingPicker';

/** The part of an mdast node this reads. */
export interface MdNode {
  type: string;
  children?: MdNode[];
  position?: { start: { line: number } };
}

const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);
const DEBOUNCE_MS = 200;

/** Node decorations carrying `data-md-line` for each top-level block and list item, walking `pm` and the mdast `root` in parallel; a level whose counts differ is skipped. `lineOffset` is the number of lines before the body. */
export function lineDecorations(doc: Node, root: MdNode, lineOffset: number): Decoration[] {
  const out: Decoration[] = [];
  const mark = (from: number, node: Node, md: MdNode) => {
    const line = md.position?.start.line;
    if (line) out.push(Decoration.node(from, from + node.nodeSize, { 'data-md-line': String(line + lineOffset) }));
  };
  const walkList = (list: Node, listPos: number, mdList: MdNode) => {
    const items = mdList.children ?? [];
    if (list.childCount !== items.length) return;
    list.forEach((item, offset, i) => {
      const pos = listPos + 1 + offset;
      const md = items[i]!;
      if (item.attrs.checked == null) mark(pos, item, md);
      walkNested(item, pos, md);
    });
  };
  const walkNested = (item: Node, itemPos: number, mdItem: MdNode) => {
    const pmLists: { node: Node; pos: number }[] = [];
    item.forEach((child, offset) => {
      if (LIST_TYPES.has(child.type.name)) pmLists.push({ node: child, pos: itemPos + 1 + offset });
    });
    const mdLists = (mdItem.children ?? []).filter((c) => c.type === 'list');
    if (pmLists.length !== mdLists.length) return;
    pmLists.forEach((l, i) => walkList(l.node, l.pos, mdLists[i]!));
  };
  const top = root.children ?? [];
  if (doc.childCount !== top.length) return out;
  doc.forEach((node, offset, i) => {
    const md = top[i]!;
    if (LIST_TYPES.has(node.type.name)) walkList(node, offset, md);
    else mark(offset, node, md);
  });
  return out;
}

const key = new PluginKey<DecorationSet>('deckbuilder.lineNumbers');

function compute(view: EditorView): void {
  if (view.isDestroyed) return;
  const api = navApis.get(view);
  let set = DecorationSet.empty;
  if (api?.host.settings.lineNumbers) {
    try {
      const { front, body } = splitFrontmatter(api.getMarkdown());
      const offset = front.split('\n').length - 1;
      const remark = api.ctx.get(remarkCtx);
      const tree = remark.runSync(remark.parse(body), body) as unknown as MdNode;
      set = DecorationSet.create(view.state.doc, lineDecorations(view.state.doc, tree, offset));
    } catch (err) {
      console.error('Markdown line numbers failed', err);
    }
  }
  const prev = key.getState(view.state);
  if (set === DecorationSet.empty && (!prev || prev === DecorationSet.empty)) return;
  view.dispatch(view.state.tr.setMeta(key, set).setMeta('addToHistory', false));
}

/** Recomputes the numbers now; called when the setting is toggled. */
export const refreshLineNumbers = (view: EditorView): void => compute(view);

const lineNumbersPlugin = $prose(() => new Plugin<DecorationSet>({
  key,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const meta = tr.getMeta(key) as DecorationSet | undefined;
      if (meta) return meta;
      return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
    },
  },
  props: { decorations: (state) => key.getState(state) },
  view: () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
      update(view, prev) {
        if (view.state.doc.eq(prev.doc) || !navApis.get(view)?.host.settings.lineNumbers) return;
        clearTimeout(timer);
        timer = setTimeout(() => compute(view), DEBOUNCE_MS);
      },
      destroy: () => clearTimeout(timer),
    };
  },
}));

export const lineNumbersFeature: RichFeature = { plugins: [lineNumbersPlugin] };
