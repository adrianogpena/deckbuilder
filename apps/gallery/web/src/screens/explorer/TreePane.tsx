import { useState, type ReactNode } from 'react';
import { Icon, useCommand } from '@deckbuilder/ui';
import type { Project } from '../../api';
import { commandById } from '../../commands';
import { t } from '../../i18n';
import { ProjectPicker, type ProjectPickerProps } from './ProjectPicker';
import { ProjectSearch } from './ProjectSearch';
import { ProjectTree, type ProjectTreeProps } from './ProjectTree';

export interface TreePaneProps extends ProjectTreeProps, Omit<ProjectPickerProps, 'current' | 'actions'> {
  project: Project;
  /** This pane is the one the user last clicked; Ctrl+Shift+F searches its project. */
  focused: boolean;
  onFocus(): void;
  /** Extra header buttons, after the search button. */
  actions?: ReactNode;
}

/** One sidebar tree: the project picker, and the project's tree or, while searching, its search panel. */
export function TreePane({ focused, onFocus, actions, projects, onPick, onAdd, onEdit, onRemove, ...tree }: TreePaneProps) {
  const { project } = tree;
  const [searching, setSearching] = useState(false);
  const [signal, setSignal] = useState(0);

  const openSearch = () => {
    setSearching(true);
    setSignal((n) => n + 1);
  };
  useCommand(commandById('explorer.search'), openSearch, { enabled: focused });

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={openSearch} title={t('explorer.search.open')} aria-label={t('explorer.search.open')}>
              <Icon name="search" />
            </button>
            {actions}
          </>
        }
      />
      <div className="xp-pane-body">
        {searching && <ProjectSearch project={project} onOpenFile={tree.onPreviewFile ?? tree.onOpenFile} onClose={() => setSearching(false)} focusSignal={signal} />}
        <div hidden={searching}>
          <ProjectTree {...tree} />
        </div>
      </div>
    </div>
  );
}
