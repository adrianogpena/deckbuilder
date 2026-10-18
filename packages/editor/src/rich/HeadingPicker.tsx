import './nav.css';
import { createT, useModalOpen } from '@deckbuilderkit/ui';
import { TextSelection } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownToc, type TocHeading } from '../MarkdownToc';
import { type DocHeading, filterHeadings, scanHeadings } from '../toc';
import type { RichApi } from './commands';

type Label = 'explorer.md.goToHeading' | 'explorer.md.headingPlaceholder' | 'explorer.md.noHeadings';
/** The labels are registered by the explorer view (`packages/view-explorer/src/i18n.ts`). */
const t = createT<Label>();

/** The api of each mounted pane, for the keymap and click handlers that only get the view. */
export const navApis = new WeakMap<EditorView, RichApi>();
/** Opens the heading picker of a pane. */
export const pickerOpeners = new WeakMap<EditorView, () => void>();
/** Called after each document change of a pane. */
export const docListeners = new WeakMap<EditorView, Set<() => void>>();

const PAGE = 8;

/** Puts the cursor in the heading at `pos` and scrolls it to the top of the pane. */
export function revealHeading(view: EditorView, pos: number): void {
  const { doc } = view.state;
  if (pos < 0 || pos >= doc.content.size) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos + 1))));
  view.dom.focus({ preventScroll: true });
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** A filtered list of the document's headings; Enter or a click picks one. */
export function HeadingPicker({ headings, onPick, onClose }: { headings: DocHeading[]; onPick(h: DocHeading): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useModalOpen();
  const shown = useMemo(() => filterHeadings(headings, query), [headings, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const move = (e: React.KeyboardEvent, to: (i: number) => number) => {
    e.preventDefault();
    setIndex((i) => Math.max(0, Math.min(shown.length - 1, to(i))));
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette md-heading-pick" role="dialog" aria-modal="true" aria-label={t('explorer.md.goToHeading')}>
        <div className="pal-input">
          <span className="pal-key">#</span>
          <input
            ref={input}
            value={query}
            placeholder={t('explorer.md.headingPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') move(e, (i) => i + 1);
              else if (e.key === 'ArrowUp') move(e, (i) => i - 1);
              else if (e.key === 'PageDown') move(e, (i) => i + PAGE);
              else if (e.key === 'PageUp') move(e, (i) => i - PAGE);
              else if (e.key === 'Enter' && shown[index]) {
                e.preventDefault();
                onPick(shown[index]!);
              }
            }}
          />
        </div>
        <div className="pal-list" ref={list}>
          {shown.length === 0 && <div className="pal-empty">{t('explorer.md.noHeadings')}</div>}
          {shown.map((h, i) => (
            <button key={h.pos} type="button" className={`pal-item${i === index ? ' active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => onPick(h)}>
              <span className="pal-label" style={{ paddingLeft: (h.level - 1) * 12 }}>{h.text}</span>
              <span className="pal-hint">H{h.level}</span>
            </button>
          ))}
        </div>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd>{t('palette.navigate')}</span>
          <span><kbd>enter</kbd>{t('palette.open')}</span>
          <span><kbd>esc</kbd>{t('palette.close')}</span>
        </div>
      </div>
    </div>
  );
}

function sameHeadings(a: TocHeading[], b: TocHeading[]): boolean {
  return a.length === b.length && a.every((h, i) => h.el === b[i]!.el && h.level === b[i]!.level && h.text === b[i]!.text);
}

/** The heading rail (`MarkdownToc`) of the rich document, pinned to the top of its scroller. */
function Outline({ api }: { api: RichApi }) {
  const { view } = api;
  const scroller = view.dom.closest<HTMLElement>('.md-rich-scroll');
  const doc = view.dom.closest<HTMLElement>('.md-rich-doc');
  const content = useMemo(() => ({ current: doc }), [doc]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  useLayoutEffect(() => {
    if (!scroller) return;
    const el = document.createElement('div');
    el.className = 'md-rich-toc-slot';
    scroller.prepend(el);
    setSlot(el);
    return () => {
      el.remove();
      scroller.classList.remove('md-rich-has-toc');
    };
  }, [scroller]);

  useEffect(() => {
    const update = () => {
      const next = scanHeadings(view.state.doc)
        .filter((h) => h.level <= 3)
        .flatMap((h) => {
          const el = view.nodeDOM(h.pos);
          return el instanceof HTMLElement ? [{ el, level: h.level, text: h.text }] : [];
        });
      setHeadings((prev) => (sameHeadings(prev, next) ? prev : next));
    };
    update();
    let set = docListeners.get(view);
    if (!set) docListeners.set(view, (set = new Set()));
    const listeners = set;
    listeners.add(update);
    return () => void listeners.delete(update);
  }, [view]);

  useEffect(() => {
    scroller?.classList.toggle('md-rich-has-toc', headings.length >= 2);
  }, [scroller, headings]);

  return slot ? createPortal(<MarkdownToc headings={headings} content={content} />, slot) : null;
}

/** The nav feature's overlay: the heading picker when asked, the outline rail when the setting is on. */
export function NavOverlay({ api }: { api: RichApi }) {
  const [picking, setPicking] = useState(false);
  const { view } = api;

  useEffect(() => {
    navApis.set(view, api);
    pickerOpeners.set(view, () => setPicking(true));
    return () => {
      navApis.delete(view);
      pickerOpeners.delete(view);
    };
  }, [view, api]);

  const headings = useMemo(() => (picking ? scanHeadings(view.state.doc) : []), [picking, view]);
  const close = () => {
    setPicking(false);
    view.focus();
  };

  return (
    <>
      {picking && (
        <HeadingPicker
          headings={headings}
          onClose={close}
          onPick={(h) => {
            setPicking(false);
            revealHeading(view, h.pos);
          }}
        />
      )}
      {api.host.settings.toc && <Outline api={api} />}
    </>
  );
}
