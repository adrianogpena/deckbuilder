import type { MouseEvent } from 'react';
import { wordAt } from './log';

/** Index into the text of `container` under the point, or null when the point is not on its text. */
function textIndexAt(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as unknown as {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let index = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return index + offset;
    index += n.textContent?.length ?? 0;
  }
  return null;
}

export function wordUnder(e: MouseEvent<HTMLElement>, text: string): string {
  const el = e.currentTarget.querySelector<HTMLElement>('.log-text');
  const index = el ? textIndexAt(el, e.clientX, e.clientY) : null;
  if (index === null) return '';
  return wordAt(text, index) || (index > 0 ? wordAt(text, index - 1) : '');
}
