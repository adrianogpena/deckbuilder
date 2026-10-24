import type { ReactNode } from 'react';
import { useAsync } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip, relTime, type Tone as ChipTone } from '../../kit';
import { runAction } from '../../source';
import { podOverview, type Amounts, type PodOverview as Overview, type PodUsage } from './detail';
import type { Pod } from './model';
import type { Tone } from './status';
import type { PodsConfig } from './PodsPanel';
import './pods.css';

export interface PodTarget {
  context: string;
  namespace: string;
  pod: string;
}

const chipTone = (t: Tone): ChipTone => (t === 'err' ? 'danger' : t === 'muted' ? 'neutral' : t);

const cores = (n: number) => (n >= 1 ? `${+n.toFixed(2)}` : `${Math.round(n * 1000)}m`);
const bytes = (n: number) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)}Gi` : `${Math.round(n / 2 ** 20)}Mi`);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pod-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const amounts = (a: { cpu: string; memory: string }) => `${a.cpu || '–'} / ${a.memory || '–'}`;

function Body({ ov, target, ready }: { ov: Overview; target: PodTarget; ready: string }) {
  const u = ov.totals.usage;
  const [r, total] = ready.split('/').map(Number);
  const allReady = r === total;
  const usageText = (a: Amounts | undefined, kind: 'cpu' | 'memory', req: number, lim: number) => {
    if (!a) return '–';
    const fmt = kind === 'cpu' ? cores : bytes;
    const extra = [req ? `${tKey('dash.pods.ov.requests')} ${fmt(req)}` : '', lim ? `${tKey('dash.pods.ov.limits')} ${fmt(lim)}` : ''].filter(Boolean);
    return extra.length ? `${fmt(a[kind])} (${extra.join(', ')})` : fmt(a[kind]);
  };
  const labels = Object.entries(ov.labels);
  const annotations = Object.entries(ov.annotations);
  return (
    <div className="pod-overview">
      <dl className="pod-facts">
        <Fact label={tKey('dash.pods.ov.kind')}>Pod</Fact>
        <Fact label={tKey('dash.pods.ov.namespace')}>{target.namespace}</Fact>
        <Fact label={tKey('dash.pods.ov.created')}>
          {ov.created ? `${new Date(ov.created).toLocaleString()} (${relTime(ov.created)})` : '–'}
        </Fact>
        <Fact label={tKey('dash.pods.ov.status')}><Chip tone={chipTone(ov.tone)}>{ov.status}</Chip></Fact>
        <Fact label={tKey('dash.pods.ov.node')}>{ov.node || '–'}</Fact>
        <Fact label={tKey('dash.pods.ov.podIP')}>{ov.podIP || '–'}</Fact>
        <Fact label={tKey('dash.pods.ov.cpu')}>{usageText(u, 'cpu', ov.totals.requests.cpu, ov.totals.limits.cpu)}</Fact>
        <Fact label={tKey('dash.pods.ov.memory')}>{usageText(u, 'memory', ov.totals.requests.memory, ov.totals.limits.memory)}</Fact>
      </dl>
      <div className={`pod-callout pod-callout-${allReady ? 'ok' : 'warn'}`}>
        {allReady ? tKey('dash.pods.ov.ready', { ready }) : tKey('dash.pods.ov.notReady', { ready })}
      </div>

      <h4 className="pod-h">{tKey('dash.pods.ov.containers')}</h4>
      <div className="pod-containers">
        {ov.containers.map((c) => (
          <div key={`${c.init}-${c.name}`} className="pod-container">
            <div className="pod-container-head">
              <strong>{c.name}</strong>
              {c.init && <Chip tone="info">{tKey('dash.pods.ov.init')}</Chip>}
              <Chip tone={chipTone(c.tone)}>{c.state}</Chip>
              <span className="pod-dim">{tKey('dash.pods.ov.restarts')}: {c.restarts}</span>
            </div>
            <div className="pod-dim pod-wrap">{c.image}</div>
            {c.message && <div className="pod-wrap">{c.message}</div>}
            {c.lastTerminated && (
              <div className="pod-dim">
                {tKey('dash.pods.ov.lastTerminated')}: {c.lastTerminated.reason}
                {c.lastTerminated.exitCode !== undefined ? ` (${c.lastTerminated.exitCode})` : ''}
                {c.lastTerminated.finishedAt ? ` · ${new Date(c.lastTerminated.finishedAt).toLocaleString()}` : ''}
              </div>
            )}
            <div className="pod-dim">
              {tKey('dash.pods.ov.requests')} {amounts(c.requests)} · {tKey('dash.pods.ov.limits')} {amounts(c.limits)}
              {c.usage ? ` · ${tKey('dash.pods.ov.usage')} ${cores(c.usage.cpu)} / ${bytes(c.usage.memory)}` : ''}
            </div>
          </div>
        ))}
      </div>

      <h4 className="pod-h">{tKey('dash.pods.ov.conditions')}</h4>
      {ov.conditions.length === 0 ? (
        <p className="pod-dim">{tKey('dash.pods.ov.none')}</p>
      ) : (
        <table className="pod-table">
          <thead>
            <tr>
              <th>{tKey('dash.pods.ov.type')}</th>
              <th>{tKey('dash.pods.ov.status')}</th>
              <th>{tKey('dash.pods.ov.reason')}</th>
              <th>{tKey('dash.pods.ov.message')}</th>
              <th>{tKey('dash.pods.ov.transition')}</th>
            </tr>
          </thead>
          <tbody>
            {ov.conditions.map((c) => (
              <tr key={c.type}>
                <td>{c.type}</td>
                <td>{c.status}</td>
                <td>{c.reason}</td>
                <td>{c.message}</td>
                <td>{c.lastTransitionTime ? relTime(c.lastTransitionTime) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="pod-h">{tKey('dash.pods.ov.labels')}</h4>
      {labels.length === 0 ? (
        <p className="pod-dim">{tKey('dash.pods.ov.none')}</p>
      ) : (
        <div className="pod-chips">
          {labels.map(([k, v]) => <Chip key={k} title={`${k}=${v}`}>{`${k}=${v}`}</Chip>)}
        </div>
      )}

      {annotations.length > 0 && (
        <details className="pod-annotations">
          <summary>{tKey('dash.pods.ov.annotations')} ({annotations.length})</summary>
          <dl className="pod-kv">
            {annotations.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

/** What the list data already knows, shown while the detail loads. */
function Basics({ pod }: { pod: Pod }) {
  const [r, total] = pod.ready.split('/').map(Number);
  const allReady = r === total;
  return (
    <div className="pod-overview">
      <dl className="pod-facts">
        <Fact label={tKey('dash.pods.ov.kind')}>Pod</Fact>
        <Fact label={tKey('dash.pods.ov.namespace')}>{pod.namespace}</Fact>
        <Fact label={tKey('dash.pods.ov.status')}><Chip tone={chipTone(pod.tone ?? 'muted')}>{pod.status}</Chip></Fact>
      </dl>
      <div className={`pod-callout pod-callout-${allReady ? 'ok' : 'warn'}`}>
        {allReady ? tKey('dash.pods.ov.ready', { ready: pod.ready }) : tKey('dash.pods.ov.notReady', { ready: pod.ready })}
      </div>
      <p className="pod-dim pod-pad">{tKey('dash.pods.describe.loading')}</p>
    </div>
  );
}

/** Overview tab of a pod in the side panel; polls the pod detail at the panel refresh rate. */
export function PodOverview({ config, target, pod }: { config: PodsConfig; target: PodTarget; pod: Pod }) {
  const ready = pod.ready;
  const state = useAsync(
    () => runAction<{ pod: unknown; usage?: PodUsage }>('pods', 'detail', config, target),
    [target.context, target.namespace, target.pod],
    config.refreshSec * 1000,
  );
  if (state.error && !state.data) return <p className="pods-error">{state.error.message}</p>;
  if (!state.data) return <Basics pod={pod} />;
  return <Body ov={podOverview(state.data.pod, state.data.usage)} target={target} ready={ready} />;
}
