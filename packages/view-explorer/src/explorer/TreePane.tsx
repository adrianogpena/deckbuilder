import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Icon, ProjectPicker, type ProjectPickerProps, useCommand, useShortcutTip } from '@deckbuilderkit/ui';
import type { Project, SearchHit } from '../client';
import { explorerCommandById as commandById } from '../commands';
import { nodeId } from '../explorer-paths';
import { t } from '../i18n';
import { ProjectSearch } from './ProjectSearch';
import { ProjectTree, type ProjectTreeApi, type ProjectTreeProps } from './ProjectTree';
import { findInTree } from './tree-find';

export interface TreePaneProps extends ProjectTreeProps, Omit<ProjectPickerProps, 'current' | 'actions'> {
  project: Project;
  /** This pane is the one the user last clicked; Ctrl+Shift+F searches its project. */
  focused: boolean;
  /** Start with the excluded entries shown. */
  showHidden?: boolean;
  onFocus(): void;
  /** The Explorer settings that decide what the tree lists. */
  exclude: string[];
  sort: string;
  /** Every path of the project, for find in the tree; `ensureNames` loads or refreshes it. */
  names?: SearchHit[];
  ensureNames?(): void;
  /** Show a second tree below; listed in the header's more menu. */
  onSplit?(): void;
  /** Close this tree; listed in the header's more menu. */
  onCloseTree?(): void;
  /** Reveal the active file in the tree, switching project if needed; undefined while no file is open. */
  onGoToFile?(): void;
}

/** One sidebar tree: the project picker, and the project's tree or, while searching, its search panel. */
export function TreePane({ focused, showHidden = false, onFocus, exclude, sort, names, ensureNames, onSplit, onCloseTree, onGoToFile, apiRef, projects, onPick, onAdd, onEdit, onRemove, ...tree }: TreePaneProps) {
  const { project } = tree;
  const own = useRef<ProjectTreeApi>(null);
  useImperativeHandle(apiRef, () => ({
    newFile: () => own.current?.newFile(),
    newFolder: () => own.current?.newFolder(),
    refresh: () => own.current?.refresh(),
    collapseAll: () => own.current?.collapseAll(),
    expandAll: () => own.current?.expandAll(),
    canCollapse: () => own.current?.canCollapse() ?? false,
    reveal: (path) => own.current?.reveal(path),
    scrollTo: (path) => own.current?.scrollTo(path),
    finding: () => own.current?.finding() ?? false,
    selectedFolder: () => own.current?.selectedFolder() ?? '',
  }));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  const [moreBox, setMoreBox] = useState<{ top: number; right: number; maxHeight: number }>();
  useEffect(() => {
    if (!moreOpen || !moreWrap.current) return setMoreBox(undefined);
    const r = moreWrap.current.getBoundingClientRect();
    setMoreBox({ top: r.bottom + 4, right: window.innerWidth - r.right, maxHeight: Math.max(120, window.innerHeight - r.bottom - 12) });
  }, [moreOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const away = (e: MouseEvent) => {
      if (!moreWrap.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [moreOpen]);
  const tip = useShortcutTip();
  const item = (icon: string, label: string, act: () => void, checked?: boolean) => (
    <button
      type="button"
      className="menu-item"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      title={label}
      onClick={() => {
        setMoreOpen(false);
        act();
      }}
    >
      <span className="menu-icon"><Icon name={icon as never} size={14} /></span>
      <span className="menu-label">{label}</span>
      {checked && <Icon name="check" size={14} />}
    </button>
  );
  const [searching, setSearching] = useState(false);
  const [showExcluded, setShowExcluded] = useState(showHidden);
  const [signal, setSignal] = useState(0);
  const [finding, setFinding] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [filterMode, setFilterMode] = useState(true);
  const [matchAt, setMatchAt] = useState(-1);
  const findInput = useRef<HTMLInputElement>(null);
  const [inside, setInside] = useState(false);

  const result = useMemo(() => (finding && names ? findInTree(findQuery, names) : undefined), [finding, findQuery, names]);
  useEffect(() => setMatchAt(-1), [result]);

  const openFind = () => {
    setFinding(true);
    ensureNames?.();
    findInput.current?.focus();
    findInput.current?.select();
  };
  const closeFind = () => {
    setFinding(false);
    setFindQuery('');
  };
  const stepMatch = (delta: number) => {
    if (!result?.order.length) return;
    const next = (matchAt + delta + result.order.length) % result.order.length;
    setMatchAt(next);
    own.current?.scrollTo(result.order[next]!);
  };

  const openSearch = () => {
    setSearching(true);
    setSignal((n) => n + 1);
  };
  useCommand(commandById('explorer.search'), openSearch, { enabled: focused && inside });
  useCommand(commandById('explorer.find'), openFind, { enabled: focused && inside });
  useEffect(() => {
    if (finding) findInput.current?.focus();
  }, [finding]);
  const collapsible = tree.expanded.some((id) => id !== nodeId(project.id, ''));
  const toggleAll = () => (collapsible ? own.current?.collapseAll() : own.current?.expandAll());
  useCommand(commandById('explorer.collapseAll'), toggleAll, { enabled: focused });

  return (
    <div
      className="xp-pane"
      onMouseDownCapture={() => {
        onFocus();
        setInside(true);
      }}
      onFocusCapture={() => {
        onFocus();
        setInside(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false);
      }}
    >
      <ProjectPicker
        projects={projects}
        current={project}
        onPick={onPick}
        onAdd={onAdd}
        onEdit={onEdit}
        onRemove={onRemove}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => own.current?.newFile()} title={t('explorer.newFile')} aria-label={t('explorer.newFile')}>
              <Icon name="file-plus" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={toggleAll} title={tip(t(collapsible ? 'explorer.collapseAll' : 'explorer.expandAll'), collapsible ? 'explorer.collapseAll' : undefined)} aria-label={t(collapsible ? 'explorer.collapseAll' : 'explorer.expandAll')}>
              <Icon name={collapsible ? 'collapse-all' : 'expand-all'} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onGoToFile} disabled={!onGoToFile} title={t('explorer.goToFile')} aria-label={t('explorer.goToFile')}>
              <Icon name="locate" />
            </button>
            <div className="menu-wrap" ref={moreWrap} onKeyDown={(e) => e.key === 'Escape' && setMoreOpen(false)}>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-haspopup="menu" title={t('explorer.more')} aria-label={t('explorer.more')}>
                <Icon name="more" />
              </button>
              {moreOpen && moreBox && (
                <div className="menu" role="menu" style={{ position: 'fixed', overflowY: 'auto', ...moreBox }}>
                  {item('search', t('explorer.search.open'), openSearch)}
                  {item('folder-plus', t('explorer.newFolder'), () => own.current?.newFolder())}
                  {item('refresh', t('explorer.refresh'), () => own.current?.refresh())}
                  {tree.onOpenDetails && item('table', t('explorer.openDetails'), () => tree.onOpenDetails?.(project.id, own.current?.selectedFolder() ?? ''))}
                  {item(showExcluded ? 'eye' : 'eye-off', t('explorer.showExcluded'), () => setShowExcluded(!showExcluded), showExcluded)}
                  {onSplit && item('split-down', t('explorer.split'), onSplit)}
                  {onCloseTree && item('close', t('explorer.closeTree'), onCloseTree)}
                </div>
              )}
            </div>
          </>
        }
      />
      {finding && (
        <div className="xp-find">
          <input
            ref={findInput}
            type="search"
            value={findQuery}
            placeholder={t('explorer.find.placeholder')}
            aria-label={t('explorer.find.placeholder')}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                closeFind();
              } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepMatch(-1);
              }
            }}
          />
          <span className="xp-find-count muted">
            {findQuery.trim() ? (result?.order.length ? `${matchAt >= 0 ? matchAt + 1 : 0}/${result.order.length}` : names ? t('explorer.find.none') : '…') : ''}
          </span>
          <button type="button" className={`chip${filterMode ? ' chip-on' : ''}`} onClick={() => setFilterMode(!filterMode)} aria-pressed={filterMode} title={t('explorer.find.filterHint')}>
            {t('explorer.find.filter')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={closeFind} title={t('explorer.search.close')} aria-label={t('explorer.search.close')}>
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="xp-pane-body">
        {searching && <ProjectSearch project={project} exclude={exclude} onOpenFile={tree.onPreviewFile ?? tree.onOpenFile} onClose={() => setSearching(false)} focusSignal={signal} />}
        <div className="xp-tree-wrap" hidden={searching}>
          <ProjectTree {...tree} view={{ exclude, sort, showExcluded }} find={result && { mode: filterMode ? 'filter' : 'highlight', result }} apiRef={own} />
        </div>
      </div>
    </div>
  );
}
