import { useCallback, useEffect, useState } from 'react';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps } from '../../workspace/types';
import { getLogs, getTargets, openRunUrl, startRun, stopRun, type RunState, type RunTarget } from './api';
import './style.css';

const POLL_MS = 1500;

function RunBody({ project }: { project: string | undefined }) {
  const [targets, setTargets] = useState<RunTarget[] | undefined>();
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [logOf, setLogOf] = useState<string | undefined>();
  const [log, setLog] = useState('');

  const refresh = useCallback(async () => {
    if (!project) return;
    const r = await getTargets(project).catch(() => undefined);
    if (!r) return;
    setTargets(r.targets);
    setRuns(Object.fromEntries(r.runs.map((x) => [x.target, x])));
  }, [project]);

  useEffect(() => {
    setTargets(undefined);
    setLogOf(undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!project || !logOf) return;
    let live = true;
    const load = () => void getLogs(project, logOf).then((r) => live && setLog(r.log), () => undefined);
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [project, logOf]);

  const act = (fn: typeof startRun, target: string) => {
    if (project) void fn(project, target).then(() => refresh(), () => undefined);
  };

  if (!project) return <p className="agents-empty agents-placeholder">{t('panel.run.noProject')}</p>;
  if (!targets) return <div className="agents-run" />;
  if (targets.length === 0) return <p className="agents-empty agents-placeholder">{t('panel.run.empty')}</p>;
  return (
    <ul className="agents-run">
      {targets.map((x) => {
        const run = runs[x.id];
        const status = run?.status ?? 'stopped';
        const running = status === 'running';
        return (
          <li key={x.id} className="agents-run-item" data-status={status}>
            <div className="agents-run-row">
              <span className="agents-run-dot" aria-hidden="true" />
              <span className="agents-run-label" title={x.source}>{x.label}</span>
              <span className="agents-run-status">
                {t(`panel.run.status.${status}`)}
                {status === 'exited' && run?.exitCode != null ? ` (${t('panel.run.exitCode', { code: run.exitCode })})` : ''}
              </span>
              <span className="agents-run-actions">
                {running ? (
                  <>
                    <button type="button" className="agents-run-btn" onClick={() => act(stopRun, x.id)}>{t('panel.run.stop')}</button>
                    <button type="button" className="agents-run-btn" onClick={() => act(startRun, x.id)}>{t('panel.run.restart')}</button>
                  </>
                ) : (
                  <button type="button" className="agents-run-btn" onClick={() => act(startRun, x.id)}>{t('panel.run.start')}</button>
                )}
                <button type="button" className="agents-run-btn" aria-pressed={logOf === x.id} onClick={() => setLogOf(logOf === x.id ? undefined : x.id)}>
                  {logOf === x.id ? t('panel.run.hideLogs') : t('panel.run.logs')}
                </button>
              </span>
            </div>
            {run?.url && (
              <a
                className="agents-run-url"
                href={run.url}
                title={t('panel.run.openUrl', { url: run.url })}
                onClick={(e) => {
                  e.preventDefault();
                  void openRunUrl(project, x.id).catch(() => undefined);
                }}
              >
                {run.url}
              </a>
            )}
            {logOf === x.id && <pre className="agents-run-log">{log || t('panel.run.noLogs')}</pre>}
          </li>
        );
      })}
    </ul>
  );
}

export const panel: PanelModule = {
  kind: 'run',
  titleKey: 'panel.run.title',
  icon: 'play',
  placement: 'both',
  single: true,
  Panel: ({ project }: PanelProps) => (
    <div className="agents-panel-run">
      <RunBody project={project} />
    </div>
  ),
  Section: ({ project }: SectionProps) => <RunBody project={project} />,
};
