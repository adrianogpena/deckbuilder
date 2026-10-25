import './toolbar.css';
import { ContextMenu, type ContextMenuItem, createT, Icon, IconButton, type IconName } from '@kedalion/ui';
import { redoCommand, undoCommand } from '@milkdown/plugin-history';
import { redoDepth, undoDepth } from '@milkdown/prose/history';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { $prose, callCommand } from '@milkdown/utils';
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type RichApi, type RichCommandId, type RichFeature, runRichCommand } from './commands';
import { FEATURES } from './features';
import { applyLink, type BlockKind, formatState, type FormatState, setLinkPrompt, splitOverflow } from './format';

type Label =
  | 'explorer.md.more' | 'explorer.md.paragraph' | 'explorer.md.heading1' | 'explorer.md.heading2' | 'explorer.md.heading3'
  | 'explorer.md.bold' | 'explorer.md.italic' | 'explorer.md.strike' | 'explorer.md.bulletList' | 'explorer.md.numberedList'
  | 'explorer.md.link' | 'explorer.md.table' | 'explorer.md.codeBlock' | 'explorer.md.undo' | 'explorer.md.redo';
/** The labels are registered by the explorer view (`packages/view-explorer/src/i18n.ts`). */
const t = createT<Label>();

/** Toolbar re-render triggers, per view: every view update (selection, document) calls them. */
const listeners = new WeakMap<EditorView, Set<() => void>>();

const updates = $prose(() => new Plugin({
  key: new PluginKey('kedalion.toolbarUpdates'),
  view: () => ({ update: (view) => listeners.get(view)?.forEach((fn) => fn()) }),
}));

interface ToolbarState extends FormatState {
  undo: boolean;
  redo: boolean;
}

function readState(view: EditorView): ToolbarState {
  return { ...formatState(view.state), undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0 };
}

const sameState = (a: ToolbarState, b: ToolbarState) => (Object.keys(a) as Array<keyof ToolbarState>).every((k) => a[k] === b[k]);

/** 24×24 stroke glyphs the icon set lacks (numbered list, undo, redo). */
function Stroke({ d }: { d: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

interface Item {
  id: string;
  label: string;
  icon?: IconName;
  glyph?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  run(): void;
}

const BLOCKS: Array<{ kind: Exclude<BlockKind, 'other'>; id: RichCommandId; label: Label }> = [
  { kind: 'paragraph', id: 'paragraph', label: 'explorer.md.paragraph' },
  { kind: 'h1', id: 'h1', label: 'explorer.md.heading1' },
  { kind: 'h2', id: 'h2', label: 'explorer.md.heading2' },
  { kind: 'h3', id: 'h3', label: 'explorer.md.heading3' },
];

/** The formatting toolbar: block picker, then buttons; the ones that do not fit move into a More menu. */
function Toolbar({ api }: { api: RichApi }) {
  const { view } = api;
  const [state, setState] = useState(() => readState(view));
  const [shown, setShown] = useState(Number.POSITIVE_INFINITY);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const widths = useRef<number[] | null>(null);

  useEffect(() => {
    const set = listeners.get(view) ?? new Set();
    listeners.set(view, set);
    const fn = () => setState((prev) => {
      const next = readState(view);
      return sameState(prev, next) ? prev : next;
    });
    set.add(fn);
    fn();
    setLinkPrompt(view, (href) => setLink(href));
    return () => {
      set.delete(fn);
      setLinkPrompt(view, null);
    };
  }, [view]);

  const run = (id: RichCommandId) => {
    runRichCommand(FEATURES, id, api);
    if (id !== 'insertLink') view.focus();
  };
  const history = (undo: boolean) => {
    callCommand(undo ? undoCommand.key : redoCommand.key)(api.ctx);
    view.focus();
  };

  const items: Item[] = [
    { id: 'bold', label: t('explorer.md.bold'), glyph: <span className="md-tb-glyph md-tb-b">B</span>, active: state.bold, run: () => run('bold') },
    { id: 'italic', label: t('explorer.md.italic'), glyph: <span className="md-tb-glyph md-tb-i">I</span>, active: state.italic, run: () => run('italic') },
    { id: 'strike', label: t('explorer.md.strike'), glyph: <span className="md-tb-glyph md-tb-s">S</span>, active: state.strike, run: () => run('strike') },
    { id: 'bulletList', label: t('explorer.md.bulletList'), icon: 'list-flat', active: state.bulletList, run: () => run('bulletList') },
    {
      id: 'numberedList', label: t('explorer.md.numberedList'), active: state.numberedList, run: () => run('numberedList'),
      glyph: <Stroke d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />,
    },
    { id: 'link', label: t('explorer.md.link'), icon: 'link', active: state.link, run: () => run('insertLink') },
    { id: 'table', label: t('explorer.md.table'), icon: 'table', run: () => run('insertTable') },
    { id: 'codeBlock', label: t('explorer.md.codeBlock'), icon: 'code', active: state.codeBlock, run: () => run('insertCodeBlock') },
    {
      id: 'undo', label: t('explorer.md.undo'), disabled: !state.undo, run: () => history(true),
      glyph: <Stroke d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
    },
    {
      id: 'redo', label: t('explorer.md.redo'), disabled: !state.redo, run: () => history(false),
      glyph: <Stroke d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
    },
  ];

  // Item widths are measured once, while all are shown; the row's width then decides how many fit.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      if (!widths.current) {
        const buttons = el.querySelectorAll<HTMLElement>('[data-tb-item]');
        if (buttons.length < items.length) return;
        widths.current = Array.from(buttons, (b) => b.getBoundingClientRect().width);
      }
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const moreWidth = widths.current[0] ?? 0;
      setShown(splitOverflow(widths.current, el.clientWidth, moreWidth, gap));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
    // Items are fixed; their count only matters for the first measure.
  }, []);

  const visible = items.slice(0, shown);
  const hidden = items.slice(shown);
  const menuItems: ContextMenuItem[] = hidden.map((it) => ({
    id: it.id, label: it.label, icon: it.icon, disabled: it.disabled, checked: it.active === undefined ? undefined : it.active, run: it.run,
  }));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || menuAt || link !== null) return;
    e.preventDefault();
    view.focus();
  };

  const closeLink = () => {
    setLink(null);
    view.focus();
  };

  return (
    <div className="md-tb" role="toolbar" onKeyDown={onKeyDown}>
      <select
        className="md-tb-select"
        aria-label={t('explorer.md.paragraph')}
        value={state.block === 'other' ? '' : state.block}
        onChange={(e) => {
          const block = BLOCKS.find((b) => b.kind === e.target.value);
          if (block) run(block.id);
        }}
      >
        {state.block === 'other' && <option value="" disabled hidden />}
        {BLOCKS.map((b) => <option key={b.kind} value={b.kind}>{t(b.label)}</option>)}
      </select>
      <div ref={row} className="md-tb-items">
        {visible.map((it) => (
          <button
            key={it.id}
            type="button"
            data-tb-item
            className={`btn btn-ghost btn-sm btn-icon${it.active ? ' active' : ''}`}
            title={it.label}
            aria-label={it.label}
            aria-pressed={it.active}
            disabled={it.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={it.run}
          >
            {it.glyph ?? (it.icon && <Icon name={it.icon} />)}
          </button>
        ))}
        {hidden.length > 0 && (
          <IconButton
            ref={more}
            icon="more"
            label={t('explorer.md.more')}
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const r = more.current?.getBoundingClientRect();
              if (r) setMenuAt({ x: r.left, y: r.bottom + 4 });
            }}
          />
        )}
      </div>
      {menuAt && <ContextMenu at={menuAt} items={menuItems} onClose={() => setMenuAt(null)} />}
      {link !== null && (
        <form
          className="md-tb-link"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem('href');
            applyLink(view, input instanceof HTMLInputElement ? input.value : '');
            closeLink();
          }}
        >
          <input
            name="href"
            defaultValue={link}
            placeholder="https://"
            aria-label={t('explorer.md.link')}
            autoFocus
            spellCheck={false}
            onBlur={() => setLink(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              closeLink();
            }}
          />
        </form>
      )}
    </div>
  );
}

/** The formatting toolbar with its More menu. */
export const toolbarFeature: RichFeature = {
  plugins: [updates],
  Overlay: Toolbar,
};
