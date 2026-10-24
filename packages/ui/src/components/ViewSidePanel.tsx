import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedSave } from '../hooks';
import { t } from '../i18n';
import { clampSideWidth, defaultSideWidth, readSideWidth, writeSideWidth } from '../view-side';
import { IconButton } from './Button';
import { Tabs } from './Tabs';
import { Icon, type IconName } from './ui';

export interface SidePanelTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

export interface SidePanelContent {
  id: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tabs: SidePanelTab[];
  actions?: ReactNode;
}

export interface ViewSidePanelState {
  scope: string;
  content: SidePanelContent | null;
  tab: string | null;
  open: (content: SidePanelContent, tab?: string) => void;
  close: () => void;
  toggle: () => void;
  isOpen: (id: string) => boolean;
  setTab: (tab: string) => void;
}

/** State of one view's side panel. Opening the id already open (no `tab`) closes it; a new id starts on its first tab. */
export function useViewSidePanel(scope: string): ViewSidePanelState {
  const [content, setContent] = useState<SidePanelContent | null>(null);
  const [tab, setTabState] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const last = useRef<{ content: SidePanelContent; tab: string | null } | null>(null);
  const current = useRef({ content, tab, shown });
  current.current = { content, tab, shown };

  const open = useCallback((next: SidePanelContent, wanted?: string) => {
    const cur = current.current;
    if (cur.shown && cur.content?.id === next.id && wanted === undefined) {
      last.current = cur.content ? { content: cur.content, tab: cur.tab } : last.current;
      setShown(false);
      return;
    }
    const sameId = cur.content?.id === next.id;
    const nextTab = wanted ?? (sameId && cur.tab && next.tabs.some((x) => x.id === cur.tab) ? cur.tab : next.tabs[0]?.id ?? null);
    setContent(next);
    setTabState(nextTab);
    setShown(true);
  }, []);
  const close = useCallback(() => {
    const cur = current.current;
    if (cur.content) last.current = { content: cur.content, tab: cur.tab };
    setShown(false);
  }, []);
  const toggle = useCallback(() => {
    const cur = current.current;
    if (cur.shown) return close();
    const prev = last.current;
    if (!prev) return;
    setContent(prev.content);
    setTabState(prev.tab);
    setShown(true);
  }, [close]);
  const isOpen = useCallback((id: string) => shown && content?.id === id, [shown, content]);
  return { scope, content: shown ? content : null, tab, open, close, toggle, isOpen, setTab: setTabState };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const STEP = 16;

export function ViewSidePanel({ side, children }: { side: ViewSidePanelState; children: ReactNode }) {
  const { scope, content, tab, close, setTab } = side;
  const [width, setWidth] = useState(() => readSideWidth(scope) ?? defaultSideWidth(window.innerWidth));
  const save = useDebouncedSave<number>((w) => writeSideWidth(scope, w), 300);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const resize = (w: number) => {
    const next = clampSideWidth(w);
    setWidth(next);
    save(next);
  };
  const isOpen = content !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.w + (drag.current.x - e.clientX));
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') resize(width + STEP);
    else if (e.key === 'ArrowRight') resize(width - STEP);
    else return;
    e.preventDefault();
  };

  const activeTab = content ? (content.tabs.find((x) => x.id === tab) ?? content.tabs[0]) : undefined;
  const panelId = `view-side-${scope}`;
  return (
    <div className="view-with-side">
      <div className="view-with-side-main">{children}</div>
      {content && (
        <aside className="view-side" style={{ '--view-side-w': `${width}px` } as CSSProperties} aria-label={content.title}>
          <div className="view-side-handle" role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label={t('viewSide.resize')} aria-valuemin={560} aria-valuemax={980} aria-valuenow={width}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onDoubleClick={() => resize(defaultSideWidth(window.innerWidth))} onKeyDown={onKeyDown} />
          <header className="view-side-head">
            {content.icon && <Icon name={content.icon} size={18} />}
            <div className="view-side-titles">
              <div className="view-side-title">{content.title}</div>
              {content.subtitle && <div className="view-side-subtitle">{content.subtitle}</div>}
            </div>
            {content.actions && <div className="view-side-actions">{content.actions}</div>}
            <IconButton icon="close" label={t('common.close')} onClick={close} />
          </header>
          <Tabs tabs={content.tabs} active={activeTab?.id ?? ''} onChange={setTab} idPrefix={panelId} />
          {activeTab && (
            <div className="view-side-body" role="tabpanel" id={`${panelId}-panel-${activeTab.id}`} aria-labelledby={`${panelId}-tab-${activeTab.id}`}>
              {activeTab.render()}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
