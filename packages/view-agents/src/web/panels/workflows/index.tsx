import { useEffect, useState } from 'react';
import { request, stream } from '@kedalion/ui';
import { t } from '../../../i18n';
import type { PanelModule, PanelProps, SectionProps } from '../../workspace/types';
import './style.css';

const POLL_MS = 2000;

type Status = 'running' | 'done' | 'failed';

interface WfAgent {
  agentId: string;
  label: string;
  phase?: string;
  status: Status;
  summary?: string;
}

interface WfRun {
  runId: string;
  name: string;
  status: Status;
  phases: string[];
  agents: WfAgent[];
  startedAt?: number;
}

interface Payload {
  runs: WfRun[];
}

/** The server's workflow runs for the session, pushed over a stream; polled instead when the stream fails. */
function usePayload(project: string | undefined, sessionId: string | undefined, visible: boolean): Payload | undefined {
  const [payload, setPayload] = useState<Payload>();
  useEffect(() => {
    setPayload(undefined);
    if (!project || !visible) return;
    const params = { project, sessionId };
    const abort = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = () => {
      if (timer) return;
      const load = () => void request<Payload>('GET', '/api/agents/workflows', params).then((p) => !abort.signal.aborted && setPayload(p), () => undefined);
      load();
      timer = setInterval(load, POLL_MS);
    };
    stream('/api/agents/workflows/stream', params, (item) => setPayload(item as Payload), abort.signal).then(
      () => !abort.signal.aborted && poll(),
      () => !abort.signal.aborted && poll(),
    );
    return () => {
      abort.abort();
      if (timer) clearInterval(timer);
    };
  }, [project, sessionId, visible]);
  return payload;
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function RunRow({ run }: { run: WfRun }) {
  const [open, setOpen] = useState(run.status === 'running');
  const groups = [...run.phases, undefined].map((phase) => ({ phase, agents: run.agents.filter((a) => a.phase === phase) })).filter((g) => g.agents.length > 0);
  return (
    <div className="agents-wf-run">
      <button type="button" className="agents-wf-head" aria-expanded={open} title={run.runId} onClick={() => setOpen((o) => !o)}>
        <span className="agents-wf-name">{run.name}</span>
        <span className="agents-wf-meta">{[t('panel.workflows.agents', { count: run.agents.length }), run.startedAt !== undefined ? fmtTime(run.startedAt) : undefined].filter(Boolean).join(' · ')}</span>
        <span className="agents-wf-status" data-status={run.status}>{t(`panel.workflows.${run.status}`)}</span>
      </button>
      {open && (
        <div className="agents-wf-body">
          {groups.map((g) => (
            <div key={g.phase ?? ''}>
              <div className="agents-wf-phase">{g.phase ?? t('panel.workflows.noPhase')}</div>
              {g.agents.map((a) => (
                <div key={a.agentId} className="agents-wf-agent">
                  <div className="agents-wf-agent-row">
                    <span className="agents-wf-label" title={a.label}>{a.label}</span>
                    <span className="agents-wf-status" data-status={a.status}>{t(`panel.workflows.${a.status}`)}</span>
                  </div>
                  {a.status !== 'running' && <div className="agents-wf-summary">{a.summary ?? t('panel.workflows.noResult')}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowsBody({ project, sessionId, visible = true }: { project: string | undefined; sessionId?: string; visible?: boolean }) {
  const payload = usePayload(project, sessionId, visible);
  if (!project) return <p className="agents-empty agents-placeholder">{t('panel.workflows.noProject')}</p>;
  if (!payload) return <div className="agents-workflows" />;
  if (payload.runs.length === 0) return <p className="agents-empty agents-placeholder">{t('panel.workflows.empty')}</p>;
  return (
    <div className="agents-workflows">
      {payload.runs.map((r) => <RunRow key={r.runId} run={r} />)}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'workflows',
  titleKey: 'panel.workflows.title',
  icon: 'play',
  placement: 'both',
  single: true,
  Panel: ({ project, visible, sessionId }: PanelProps) => (
    <div className="agents-panel-workflows">
      <WorkflowsBody project={project} sessionId={sessionId} visible={visible} />
    </div>
  ),
  Section: ({ project, sessionId }: SectionProps) => <WorkflowsBody project={project} sessionId={sessionId} />,
};
