import { forwardRef, lazy, Suspense } from 'react';
import { CodeView, type DiffMode, type DiffViewHandle, langOfFile } from '@deckbuilder/editor';
import type { GitFile, GitFileContent } from '@deckbuilder/server-core/protocol';
import { ErrorBanner, PanelBanner, PanelLoading, PanelNotice, useAsync } from '@deckbuilder/ui';
import { t } from '../../i18n';
import { sidesOf } from './sides';

const DiffView = lazy(() => import('@deckbuilder/editor').then((m) => ({ default: m.DiffView })));

const problemOf = (side?: GitFileContent) =>
  side?.binary ? t('git.binary') : side?.tooLarge ? t('git.tooLarge') : side?.missing ? t('git.missing') : undefined;

export interface GitDiffPaneProps {
  root: string;
  file: GitFile;
  /** Changes on every refresh, so the sides are read again. */
  tick: number;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
}

/** The diff of one changed file, or a message when it can't be shown. */
export const GitDiffPane = forwardRef<DiffViewHandle, GitDiffPaneProps>(function GitDiffPane({ root, file, tick, mode, onModeChange }, ref) {
  const sides = useAsync(() => sidesOf(root, file), [root, file.path, file.group, file.index, file.worktree, tick]);
  if (sides.error) return <ErrorBanner error={sides.error} onRetry={sides.reload} />;
  if (!sides.data) return <PanelLoading />;
  const { original, modified } = sides.data;
  const lang = langOfFile(file.path.split('/').pop() ?? file.path);
  const problem = problemOf(original) ?? problemOf(modified);
  if (problem) return <PanelNotice icon="file" title={file.path} message={problem} />;
  if (!original) {
    return (
      <div className="git-conflict">
        <PanelBanner tone="warn">{t('git.conflictNote')}</PanelBanner>
        <div className="git-conflict-body"><CodeView value={modified.text ?? ''} lang={lang} lineNumbers /></div>
      </div>
    );
  }
  return (
    <Suspense fallback={<PanelLoading />}>
      <DiffView
        ref={ref}
        original={original.text ?? ''}
        modified={modified.text ?? ''}
        lang={lang}
        mode={mode}
        onModeChange={onModeChange}
        modeLabels={{ split: t('git.split'), inline: t('git.inline') }}
      />
    </Suspense>
  );
});
