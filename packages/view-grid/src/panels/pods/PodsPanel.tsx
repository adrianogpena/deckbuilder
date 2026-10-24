import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ContextMenu, Icon, IconButton } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip, relTime } from '../../kit';
import { requestRefresh, type PanelSide } from '../../panel';
import { runAction } from '../../source';
import { formatEntries, moveEntry, parseEntries, podRows, type Pod, type PodsConfig as PodsSettings } from './model';
import { podSideContent } from './PodSide';
import type { KubeError } from './kube-errors';
import type { Tone } from './status';
import './pods.css';

export type PodsConfig = PodsSettings & { [key: string]: unknown };

export interface PodsPanelData {
  clusters: { context: string; namespace: string; error?: KubeError }[];
  pods: Pod[];
}

interface Props {
  id: string;
  config: PodsConfig;
  data: PodsPanelData | undefined;
  refresh(): void;
  side?: PanelSide;
  setConfig?(next: PodsConfig): void;
}

const CHIP_TONE: Record<Tone, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  ok: 'ok',
  warn: 'warn',
  err: 'danger',
  info: 'info',
  muted: 'neutral',
};

const target = (p: Pod) => ({ context: p.context, namespace: p.namespace, pod: p.name });

export function PodsPanel({ id, config, data, side, setConfig }: Props) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; pod: Pod } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!data) return null;
  if (data.clusters.length === 0) return <p className="kit-empty">{tKey('dash.pods.noClusters')}</p>;

  const entries = parseEntries(config.clusters);
  const rows = podRows(entries, data.pods).filter((r) => !r.pod || config.showHealthy || !r.pod.healthy);
  const content = (pod: Pod) => podSideContent({ instanceId: id, pod, config });

  const toggle = (pod: Pod) => {
    if (!side) return;
    const c = content(pod);
    if (side.isOpen(c.id)) side.close();
    else side.open(c);
  };

  const openMenu = (e: MouseEvent, pod: Pod) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ at: { x: e.clientX, y: e.clientY }, pod });
  };

  const onKey = (e: KeyboardEvent, pod: Pod) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(pod);
    }
  };

  const restart = async (pod: Pod) => {
    try {
      await runAction('pods', 'restart', config, target(pod));
    } finally {
      requestRefresh('pods');
    }
  };

  const items = (pod: Pod) => [
    { id: 'restart', label: tKey('dash.pods.restart'), icon: 'rotate-ccw' as const, danger: true, run: () => void restart(pod) },
    ...(side
      ? [
          { id: 'describe', label: tKey('dash.pods.describe'), icon: 'file-text' as const, run: () => side.open(content(pod), 'describe') },
          { id: 'logs', label: tKey('dash.pods.logs'), icon: 'log' as const, run: () => side.open(content(pod), 'logs') },
        ]
      : []),
    { id: 'copy', label: tKey('dash.pods.copyName'), icon: 'copy' as const, run: () => void navigator.clipboard.writeText(pod.name) },
  ];

  const endDrag = () => {
    setDragFrom(null);
    setOverIndex(null);
  };

  const drop = (e: DragEvent, to: number) => {
    e.preventDefault();
    const from = dragFrom;
    endDrag();
    if (from === null || from === to || !setConfig) return;
    setConfig({ ...config, clusters: formatEntries(moveEntry(entries, from, to)) });
  };

  return (
    <div className="pods">
      {data.clusters.map((c) =>
        c.error ? (
          <p key={`${c.context}/${c.namespace}`} className="pods-error">
            {c.context}/{c.namespace}: {tKey(`dash.pods.err.${c.error.code}`)}
          </p>
        ) : null,
      )}
      {rows.length === 0 && <p className="kit-empty">{tKey('dash.pods.empty')}</p>}
      <ul className="pods-list">
        {rows.map(({ entry, pod }) => {
          const index = entries.indexOf(entry);
          const dnd = {
            draggable: !!setConfig,
            onDragStart: (e: DragEvent) => {
              e.dataTransfer.setData('text/plain', String(index));
              e.dataTransfer.effectAllowed = 'move';
              setDragFrom(index);
            },
            onDragEnd: endDrag,
            onDragOver: (e: DragEvent) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setOverIndex(index);
            },
            onDrop: (e: DragEvent) => drop(e, index),
          };
          const over = dragFrom !== null && overIndex === index && dragFrom !== index ? ' pods-row-over' : '';
          const dragging = dragFrom === index ? ' pods-row-dragging' : '';
          if (!pod) {
            return (
              <li key={`${entry.context}/${entry.namespace}/${entry.pod}:${index}`} className={`pods-row pods-row-empty${over}${dragging}`} {...dnd}>
                {setConfig && <Icon name="grip" size={12} />}
                <span className="pods-name">{tKey('dash.pods.noMatch', { pod: entry.pod })}</span>
              </li>
            );
          }
          const selected = !!side && side.isOpen(content(pod).id);
          return (
            <li
              key={`${pod.context}/${pod.namespace}/${pod.name}`}
              className={`pods-row${selected ? ' pods-row--selected' : ''}${over}${dragging}`}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              onClick={() => toggle(pod)}
              onKeyDown={(e) => onKey(e, pod)}
              onContextMenu={(e) => openMenu(e, pod)}
              {...dnd}
            >
              {setConfig && <Icon name="grip" size={12} />}
              <Chip tone={CHIP_TONE[pod.tone ?? (pod.healthy ? 'ok' : 'err')]}>{pod.status}</Chip>
              <span className="pods-name" title={pod.name}>{pod.name}</span>
              <span className="pods-meta">{pod.ready}</span>
              {pod.restarts > 0 && <span className="pods-meta">{tKey('dash.pods.restarts', { count: pod.restarts })}</span>}
              {pod.startedAt && <span className="pods-meta">{relTime(pod.startedAt)}</span>}
              <IconButton icon="more" label={tKey('dash.pods.menu')} onClick={(e) => openMenu(e, pod)} />
            </li>
          );
        })}
      </ul>
      {menu && <ContextMenu at={menu.at} items={items(menu.pod)} onClose={() => setMenu(null)} />}
    </div>
  );
}
