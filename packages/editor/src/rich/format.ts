import type { Ctx } from '@milkdown/ctx';
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from '@milkdown/preset-commonmark';
import { toggleStrikethroughCommand } from '@milkdown/preset-gfm';
import { newlineInCode } from '@milkdown/prose/commands';
import type { Mark, MarkType, Node } from '@milkdown/prose/model';
import { liftListItem, splitListItem, wrapInList } from '@milkdown/prose/schema-list';
import { type Command, type EditorState, Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $prose, $useKeymap, callCommand } from '@milkdown/utils';
import type { RichApi, RichFeature, RichHandler } from './commands';

/** The block the cursor is in, for the toolbar's paragraph/heading picker. */
export type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'other';

/** What the selection looks like, for the toolbar's active states. */
export interface FormatState {
  block: BlockKind;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: boolean;
  bulletList: boolean;
  numberedList: boolean;
  codeBlock: boolean;
}

/** A task's next checkbox state: a plain item becomes an open task, a task flips. */
export function nextChecked(checked: boolean | null | undefined): boolean {
  return checked == null ? false : !checked;
}

/** Attributes of the item Enter creates after `attrs`: a task continues as an open task. */
export function splitItemAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return { ...attrs, checked: attrs.checked == null ? null : false };
}

/** A link target typed in the prompt; null removes the link. */
export function normalizeHref(input: string): string | null {
  const href = input.trim();
  return href ? href : null;
}

/** Whether a click `offsetX` px from a task item's left edge hits its checkbox (drawn in the item's left padding). */
export function isCheckboxHit(offsetX: number, paddingLeft: number): boolean {
  return offsetX >= 0 && offsetX < paddingLeft;
}

/**
 * How many of the toolbar items (`widths`, in order) fit in `available` px with `gap` between them.
 * When not all fit, room is kept for the More button (`moreWidth`).
 */
export function splitOverflow(widths: readonly number[], available: number, moreWidth: number, gap: number): number {
  const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0);
  if (total <= available) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const w of widths) {
    if (used + gap + w > available) break;
    used += gap + w;
    count++;
  }
  return count;
}

function hasMark(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** The innermost list around the selection: its node, position and depth. */
function listAround(state: EditorState): { node: Node; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') return { node, pos: $from.before(d), depth: d };
  }
  return null;
}

/** The innermost list item around the selection. */
function itemAround(state: EditorState): { node: Node; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'list_item') return { node, pos: $from.before(d) };
  }
  return null;
}

export function formatState(state: EditorState): FormatState {
  const { marks } = state.schema;
  const parent = state.selection.$from.parent;
  const level = parent.type.name === 'heading' ? Number(parent.attrs.level) : 0;
  const block: BlockKind = parent.type.name === 'paragraph' ? 'paragraph' : level >= 1 && level <= 3 ? (`h${level}` as BlockKind) : 'other';
  const list = listAround(state)?.node.type.name;
  return {
    block,
    bold: hasMark(state, marks.strong),
    italic: hasMark(state, marks.emphasis),
    strike: hasMark(state, marks.strike_through),
    link: hasMark(state, marks.link),
    bulletList: list === 'bullet_list',
    numberedList: list === 'ordered_list',
    codeBlock: parent.type.name === 'code_block',
  };
}

/** Bullet or numbered list: wraps the block, switches the list's kind, or lifts the item out of a list of that kind. */
function toggleList(kind: 'bullet_list' | 'ordered_list'): Command {
  return (state, dispatch) => {
    const target = state.schema.nodes[kind];
    const item = state.schema.nodes.list_item;
    if (!target || !item) return false;
    const list = listAround(state);
    if (list?.node.type === target) return liftListItem(item)(state, dispatch);
    if (list) {
      const attrs = kind === 'ordered_list' ? { order: 1, spread: list.node.attrs.spread } : { spread: list.node.attrs.spread };
      dispatch?.(state.tr.setNodeMarkup(list.pos, target, attrs));
      return true;
    }
    return wrapInList(target)(state, dispatch);
  };
}

/** Flips the task checkbox of the item at the cursor; a plain item or block becomes an open task. */
export const toggleTask: Command = (state, dispatch) => {
  const item = itemAround(state);
  if (item) {
    dispatch?.(state.tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, checked: nextChecked(item.node.attrs.checked) }));
    return true;
  }
  const bullet = state.schema.nodes.bullet_list;
  if (!bullet) return false;
  return wrapInList(bullet)(state, dispatch && ((tr) => {
    const { $from } = tr.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === 'list_item') {
        tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: false });
        break;
      }
    }
    dispatch(tr);
  }));
};

/** Enter in a list (T4): new code lines inside fenced code, exit on an empty item, a task continues as an open task. */
const listEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const item = state.schema.nodes.list_item;
  if (!item || !empty || $from.depth < 2) return false;
  if ($from.parent.type.spec.code) return itemAround(state) ? newlineInCode(state, dispatch) : false;
  const li = $from.node(-1);
  if (li.type !== item) return false;
  if ($from.parent.content.size === 0 && li.childCount === 1) return liftListItem(item)(state, dispatch);
  return splitListItem(item, splitItemAttrs(li.attrs))(state, dispatch);
};

const listEnterKeymap = $useKeymap('deckbuilderListEnter', {
  ListEnter: { shortcuts: 'Enter', priority: 100, command: () => listEnter },
});

/** Clicking a task's checkbox (the item's left padding) toggles it. */
const taskClick = $prose(() => new Plugin({
  key: new PluginKey('deckbuilder.taskClick'),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const li = (event.target as HTMLElement | null)?.closest?.('li[data-item-type="task"]');
        if (!(li instanceof HTMLElement) || !view.dom.contains(li)) return false;
        const pad = parseFloat(getComputedStyle(li).paddingLeft) || 0;
        if (!isCheckboxHit(event.clientX - li.getBoundingClientRect().left, pad)) return false;
        event.preventDefault();
        const $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type.name !== 'list_item') continue;
          view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: nextChecked(node.attrs.checked) }));
          return true;
        }
        return false;
      },
    },
  },
}));

/** The link range around the cursor (contiguous text carrying the same link mark). */
function linkRangeAt(state: EditorState, type: MarkType): { from: number; to: number; mark: Mark } | null {
  const { $from } = state.selection;
  const start = $from.start();
  const parts: Array<{ from: number; to: number; mark: Mark | undefined }> = [];
  $from.parent.forEach((child, offset) => {
    parts.push({ from: start + offset, to: start + offset + child.nodeSize, mark: type.isInSet(child.marks) ?? undefined });
  });
  const at = parts.findIndex((p) => p.mark && p.from <= $from.pos && $from.pos <= p.to);
  if (at < 0) return null;
  const mark = parts[at]!.mark!;
  let lo = at;
  let hi = at;
  while (lo > 0 && parts[lo - 1]!.mark?.eq(mark)) lo--;
  while (hi < parts.length - 1 && parts[hi + 1]!.mark?.eq(mark)) hi++;
  return { from: parts[lo]!.from, to: parts[hi]!.to, mark };
}

/** The href of the link at the selection, '' when there is none. */
export function currentHref(state: EditorState): string {
  const type = state.schema.marks.link;
  if (!type) return '';
  const { from, to, empty } = state.selection;
  if (empty) return String(linkRangeAt(state, type)?.mark.attrs.href ?? '');
  let href = '';
  state.doc.nodesBetween(from, to, (n) => {
    const m = type.isInSet(n.marks);
    if (m && !href) href = String(m.attrs.href ?? '');
    return !href;
  });
  return href;
}

/** Sets the link of the selection (or of the link at the cursor) to `input`; an empty input removes it, no selection inserts the URL as text. */
export function applyLink(view: EditorView, input: string): void {
  const { state } = view;
  const type = state.schema.marks.link;
  if (!type) return;
  const href = normalizeHref(input);
  let { from, to } = state.selection;
  if (from === to) {
    const range = linkRangeAt(state, type);
    if (range) ({ from, to } = range);
  }
  const tr = state.tr;
  if (from === to) {
    if (!href) return;
    tr.insertText(href, from).addMark(from, from + href.length, type.create({ href }));
  } else {
    tr.removeMark(from, to, type);
    if (href) tr.addMark(from, to, type.create({ href }));
  }
  view.dispatch(tr.scrollIntoView());
}

/** The inline URL prompt a toolbar registers per view; insertLink opens it with the current href. */
const linkPrompts = new WeakMap<EditorView, (href: string) => void>();

export function setLinkPrompt(view: EditorView, open: ((href: string) => void) | null): void {
  if (open) linkPrompts.set(view, open);
  else linkPrompts.delete(view);
}

const prose = (command: Command): RichHandler => ({ view }) => command(view.state, view.dispatch);
const milk = (run: (ctx: Ctx) => boolean): RichHandler => ({ ctx }) => run(ctx);

const handlers: RichFeature['handlers'] = {
  bold: milk(callCommand(toggleStrongCommand.key)),
  italic: milk(callCommand(toggleEmphasisCommand.key)),
  strike: milk(callCommand(toggleStrikethroughCommand.key)),
  paragraph: milk(callCommand(turnIntoTextCommand.key)),
  h1: milk(callCommand(wrapInHeadingCommand.key, 1)),
  h2: milk(callCommand(wrapInHeadingCommand.key, 2)),
  h3: milk(callCommand(wrapInHeadingCommand.key, 3)),
  bulletList: prose(toggleList('bullet_list')),
  numberedList: prose(toggleList('ordered_list')),
  toggleTask: prose(toggleTask),
  insertCodeBlock: milk(callCommand(createCodeBlockCommand.key)),
  insertLink: (api: RichApi) => {
    const open = linkPrompts.get(api.view);
    if (!open) return false;
    open(currentHref(api.view.state));
    return true;
  },
};

/** Formatting commands: bold, italic, strike, headings, lists, tasks, link, code block; list Enter and task clicks. */
export const formatFeature: RichFeature = {
  plugins: [...listEnterKeymap, taskClick],
  handlers,
};
