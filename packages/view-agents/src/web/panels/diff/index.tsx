import { useEffect, useState } from 'react';
import { ErrorBanner, PanelLoading, useAsync } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { FileDiff } from './FileDiff';
import { gitClient } from './git-client';
import './style.css';

const POLL_MS = 3000;

/** Live diff of one file (params `path`, `group`): the file is looked up in the project's status again as it changes. */
function DiffPanel({ project, params, visible }: PanelProps) {
  const path = String(params.path ?? '');
  const group = String(params.group ?? '');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, [visible]);
  const status = useAsync(() => gitClient.gitStatus(project), [project, tick]);
  const files = status.data?.files ?? [];
  const file = files.find((f) => f.path === path && f.group === group) ?? files.find((f) => f.path === path);

  return (
    <div className="agents-panel-diff">
      <div className="agents-diff-bar">
        <span className="agents-diff-path" title={path}>
          {path}
        </span>
      </div>
      {status.error && !status.data ? (
        <ErrorBanner error={status.error} onRetry={status.reload} />
      ) : !status.data ? (
        <PanelLoading />
      ) : !file ? (
        <p className="agents-empty agents-placeholder">{t('panel.diff.unchanged')}</p>
      ) : (
        <div className="agents-diff-body">
          <FileDiff root={project} file={file} tick={tick} />
        </div>
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'diff',
  titleKey: 'panel.diff.title',
  icon: 'file',
  placement: 'center',
  Panel: DiffPanel,
};
