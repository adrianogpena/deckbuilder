import { lazy, Suspense, useState } from 'react';
import { type DiffMode, langOfFile } from '@kedalion/editor';
import type { GitFile, GitFileContent } from '@kedalion/server-core/protocol';
import { ErrorBanner, PanelLoading, useAsync } from '@kedalion/ui';
import { t } from '../../../i18n';
import { sidesOf } from './git-client';

const DiffView = lazy(() => import('@kedalion/editor').then((m) => ({ default: m.DiffView })));

const problemOf = (side?: GitFileContent) => (side?.binary ? t('agents.changes.binary') : side?.tooLarge ? t('agents.changes.tooLarge') : undefined);

/** DiffView of one changed file; refetches in the background every `pollMs` (0 = never). */
export function FileDiff({ root, file, pollMs }: { root: string; file: GitFile; pollMs: number }) {
  const [mode, setMode] = useState<DiffMode>('split');
  const sides = useAsync(() => sidesOf(root, file), [root, file.path, file.group, file.index, file.worktree], pollMs);
  if (sides.error) return <ErrorBanner error={sides.error} onRetry={sides.reload} />;
  if (!sides.data) return <PanelLoading />;
  const { original, modified } = sides.data;
  const problem = problemOf(original) ?? problemOf(modified);
  if (problem) return <p className="agents-empty">{problem}</p>;
  return (
    <Suspense fallback={<PanelLoading />}>
      <DiffView
        original={original.text ?? ''}
        modified={modified.text ?? ''}
        lang={langOfFile(file.path.split('/').pop() ?? file.path)}
        mode={mode}
        onModeChange={setMode}
        modeLabels={{ split: t('agents.changes.split'), inline: t('agents.changes.inline') }}
      />
    </Suspense>
  );
}
