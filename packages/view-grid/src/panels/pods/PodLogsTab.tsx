import { useEffect, useRef, useState } from 'react';
import { Button, LogView, type HighlightTerm, type LogLine } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { streamSource } from '../../source';
import { detectLevel, type LogStatus } from './logs';
import type { PodTarget } from './PodOverview';
import './pods.css';

const MAX_LINES = 5000;

type Item = { lines?: string[]; status?: LogStatus; error?: string };

/** Live log tab of a pod in the side panel. */
export function PodLogsTab({ target }: { target: PodTarget }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [highlights, setHighlights] = useState<HighlightTerm[]>([]);
  const [status, setStatus] = useState<LogStatus>('running');
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    streamSource(
      'pods',
      'logs',
      { context: target.context, namespace: target.namespace, pod: target.pod, tail: 500 },
      (raw) => {
        const item = raw as Item;
        if (item.lines) {
          const added = item.lines.map((text): LogLine => {
            const level = detectLevel(text);
            return { n: counter.current++, offset: 0, text, level, own: level !== null };
          });
          setLines((prev) => [...prev, ...added].slice(-MAX_LINES));
        }
        if (item.status) {
          setStatus(item.status);
          setError(item.error ?? null);
        }
      },
      abort.signal,
    ).catch((err) => {
      if (!abort.signal.aborted) {
        setStatus('ended');
        setError(String((err as Error)?.message ?? err));
      }
    });
    return () => abort.abort();
  }, [target.context, target.namespace, target.pod]);

  return (
    <div className="pod-logs">
      <div className="pod-logs-view">
        <LogView
          lines={lines}
          highlights={highlights}
          onHighlightsChange={setHighlights}
          follow={follow}
          onFollowChange={setFollow}
        />
      </div>
      <div className="pod-logs-foot">
        <span className="pod-logs-status">
          {tKey(`dash.pods.logs.status.${status}` as 'dash.pods.logs.status.running')}
          {error ? ` · ${error}` : ''}
        </span>
        <Button icon="trash" onClick={() => setLines([])}>{tKey('dash.pods.logs.clear')}</Button>
      </div>
    </div>
  );
}
