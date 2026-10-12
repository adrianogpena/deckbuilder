import { useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Icon, useCommand } from '@deckbuilder/ui';
import type { Project } from '../../api';
import { commandById } from '../../commands';
import { t } from '../../i18n';
import { ProjectPicker, type ProjectPickerProps } from './ProjectPicker';
import { ProjectSearch } from './ProjectSearch';
import { ProjectTree, type ProjectTreeApi, type ProjectTreeProps } from './ProjectTree';

export interface TreePaneProps extends ProjectTreeProps, Omit<ProjectPickerProps, 'current' | 'actions'> {
  project: Project;
  /** This pane is the one the user last clicked; Ctrl+Shift+F searches its project. */
  focused: boolean;
  onFocus(): void;
  /** The Explorer settings that decide what the tree lists. */
  exclude: string[];
  sort: string;
  /** Extra header buttons, after the search button. */
  actions?: ReactNode;
}

/** One sidebar tree: the project picker, and the project's tree or, while searching, its search panel. */
export function TreePane({ focused, onFocus, exclude, sort, actions, apiRef, projects, onPick, onAdd, onEdit, onRemove, ...tree }: TreePaneProps) {
  const { project } = tree;
  const own = useRef<ProjectTreeApi>(null);
  useImperativeHandle(apiRef, () => ({
    newFile: () => own.current?.newFile(),
    newFolder: () => own.current?.newFolder(),
    refresh: () => own.current?.refresh(),
    collapseAll: () => own.current?.collapseAll(),
    reveal: (path) => own.current?.reveal(path),
  }));
  const [searching, setSearching] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [signal, setSignal] = useState(0);

  const openSearch = () => {
    setSearching(true);
    setSignal((n) => n + 1);
  };
  useCommand(commandById('explorer.search'), openSearch, { enabled: focused });
  useCommand(commandById('explorer.collapseAll'), () => own.current?.collapseAll(), { enabled: focused });

  return (
    <div className="xp-pane" onMouseDownCapture={onFocus} onFocusCapture={onFocus}>
      <ProjectPicker
        projects={projects}
        current={project}
        onPick={onPick}
        onAdd={onAdd}
        onEdit={onEdit}
        onRemove={onRemove}
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => own.current?.newFile()} title={t('explorer.newFile')} aria-label={t('explorer.newFile')}>
              <Icon name="file-plus" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => own.current?.newFolder()} title={t('explorer.newFolder')} aria-label={t('explorer.newFolder')}>
              <Icon name="folder-plus" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => own.current?.refresh()} title={t('explorer.refresh')} aria-label={t('explorer.refresh')}>
              <Icon name="refresh" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => own.current?.collapseAll()} title={t('explorer.collapseAll')} aria-label={t('explorer.collapseAll')}>
              <Icon name="collapse-all" />
            </button>
            <button type="button" className={`btn btn-ghost btn-sm${showExcluded ? ' active' : ''}`} onClick={() => setShowExcluded(!showExcluded)} aria-pressed={showExcluded} title={t('explorer.showExcluded')} aria-label={t('explorer.showExcluded')}>
              <Icon name={showExcluded ? 'eye' : 'eye-off'} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openSearch} title={t('explorer.search.open')} aria-label={t('explorer.search.open')}>
              <Icon name="search" />
            </button>
            {actions}
          </>
        }
      />
      <div className="xp-pane-body">
        {searching && <ProjectSearch project={project} exclude={exclude} onOpenFile={tree.onPreviewFile ?? tree.onOpenFile} onClose={() => setSearching(false)} focusSignal={signal} />}
        <div className="xp-tree-wrap" hidden={searching}>
          <ProjectTree {...tree} view={{ exclude, sort, showExcluded }} apiRef={own} />
        </div>
      </div>
    </div>
  );
}
