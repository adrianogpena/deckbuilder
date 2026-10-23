import { useState, type MouseEvent } from 'react';
import { ContextMenu, Icon, IconButton } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip, relTime } from '../../kit';
import { runAction } from '../../source';
import { DescribeDialog } from './DescribeDialog';
import type { Pod } from './model';
import './pods.css';

export interface PodsConfig {
  clusters: string;
  refreshSec: number;
  showHealthy: boolean;
  [key: string]: unknown;
}

export interface PodsPanelData {
  clusters: { context: string; namespace: string; error?: string }[];
  pods: Pod[];
}

interface Props {
  config: PodsConfig;
  data: PodsPanelData | undefined;
  refresh(): void;
  /** Opens the log viewer of a pod (filled in by the Logs step); no menu entry when omitted. */
  onLogs?(pod: Pod): void;
}

const target = (p: Pod) => ({ context: p.context, namespace: p.namespace, pod: p.name });

export function PodsPanel({ config, data, refresh, onLogs }: Props) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; pod: Pod } | null>(null);
  const [describe, setDescribe] = useState<{ pod: Pod; text?: string } | null>(null);

  if (!data) return null;
  if (data.clusters.length === 0) return <p className="kit-empty">{tKey('dash.pods.noClusters')}</p>;

  const open = (e: MouseEvent, pod: Pod) => {
    e.preventDefault();
    setMenu({ at: { x: e.clientX, y: e.clientY }, pod });
  };

  const showDescribe = async (pod: Pod) => {
    setDescribe({ pod });
    try {
      const text = await runAction<string>('pods', 'describe', config, target(pod));
      setDescribe({ pod, text });
    } catch (err) {
      setDescribe({ pod, text: String((err as Error)?.message ?? err) });
    }
  };

  const restart = async (pod: Pod) => {
    try {
      await runAction('pods', 'restart', config, target(pod));
    } finally {
      setTimeout(refresh, 3000);
    }
  };

  const items = (pod: Pod) => [
    { id: 'restart', label: tKey('dash.pods.restart'), icon: 'rotate-ccw' as const, danger: true, run: () => void restart(pod) },
    { id: 'describe', label: tKey('dash.pods.describe'), icon: 'file-text' as const, run: () => void showDescribe(pod) },
    ...(onLogs ? [{ id: 'logs', label: tKey('dash.pods.logs'), icon: 'log' as const, run: () => onLogs(pod) }] : []),
    { id: 'copy', label: tKey('dash.pods.copyName'), icon: 'copy' as const, run: () => void navigator.clipboard.writeText(pod.name) },
  ];

  return (
    <div className="pods">
      {data.clusters.map((c) => {
        const key = `${c.context}/${c.namespace}`;
        const pods = data.pods.filter((p) => p.cluster === key && (config.showHealthy || !p.healthy));
        return (
          <section key={key}>
            <h4 className="pods-cluster">{key}</h4>
            {c.error && <p className="pods-error">{tKey('dash.pods.clusterError', { error: c.error })}</p>}
            {!c.error && pods.length === 0 && <p className="kit-empty">{tKey('dash.pods.empty')}</p>}
            <ul className="pods-list">
              {pods.map((p) => (
                <li key={p.name} className="pods-row" onContextMenu={(e) => open(e, p)}>
                  <Chip tone={p.healthy ? 'ok' : 'danger'}>{p.status}</Chip>
                  <span className="pods-name" title={p.name}>{p.name}</span>
                  <span className="pods-meta">{tKey('dash.pods.ready', { ready: p.ready })}</span>
                  {p.restarts > 0 && (
                    <span className="pods-meta">
                      {tKey('dash.pods.restarts', { count: p.restarts })}
                      {p.lastRestartAt ? ` · ${tKey('dash.pods.lastRestart', { when: relTime(p.lastRestartAt) })}` : ''}
                    </span>
                  )}
                  {p.urls.map((u) => (
                    <a key={u} className="pods-meta" href={u} target="_blank" rel="noreferrer" title={u}>
                      <Icon name="link" size={12} />
                    </a>
                  ))}
                  <IconButton icon="more" label={tKey('dash.pods.menu')} onClick={(e) => open(e, p)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {menu && <ContextMenu at={menu.at} items={items(menu.pod)} onClose={() => setMenu(null)} />}
      {describe && <DescribeDialog title={describe.pod.name} text={describe.text} onClose={() => setDescribe(null)} />}
    </div>
  );
}
