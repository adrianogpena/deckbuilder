import { lazy, Suspense, useState } from 'react';
import { type DiffMode, langOfFile } from '@deckbuilder/editor';
import { ErrorBanner, PanelBanner, PanelLoading, PanelNotice, relPath, useAsync } from '@deckbuilder/ui';
import { api } from '../../api';
import { t } from '../../i18n';

const DiffView = lazy(() => import('@deckbuilder/editor').then((m) => ({ default: m.DiffView })));

export interface CompareSide {
  project: string;
  path: string;
}

export interface CompareTabProps {
  left: CompareSide;
  right: CompareSide;
  /** Initial layout, from the git.diffMode setting. */
  mode: DiffMode;
}

/** Two text files side by side (or inline); binary files get a message, truncated ones a note. */
export function CompareTab({ left, right, mode: initialMode }: CompareTabProps) {
  const [mode, setMode] = useState<DiffMode>(initialMode);
  const sides = useAsync(() => Promise.all([api.fsRead(left.project, left.path), api.fsRead(right.project, right.path)]), [left.project, left.path, right.project, right.path]);
  if (sides.error) return <ErrorBanner error={sides.error} onRetry={sides.reload} />;
  if (!sides.data) return <PanelLoading />;
  const [a, b] = sides.data;
  if (!('text' in a) || !('text' in b)) {
    const path = !('text' in a) ? left.path : right.path;
    return <PanelNotice icon="file" title={path} message={t('explorer.compareBinary')} />;
  }
  const lang = langOfFile(relPath.basename(right.path)) ?? langOfFile(relPath.basename(left.path));
  const diff = (
    <Suspense fallback={<PanelLoading />}>
      <DiffView
        original={a.text}
        modified={b.text}
        lang={lang}
        mode={mode}
        onModeChange={setMode}
        modeLabels={{ split: t('git.split'), inline: t('git.inline') }}
      />
    </Suspense>
  );
  if (!a.truncated && !b.truncated) return diff;
  return (
    <div className="git-conflict">
      <PanelBanner tone="warn">{t('explorer.compareTruncated')}</PanelBanner>
      <div className="git-conflict-body">{diff}</div>
    </div>
  );
}
