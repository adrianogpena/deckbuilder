import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBanner, Spinner, useAsync, useRovingList } from '@kedalion/ui';
import type { AgentTraceStep } from '../protocol';
import { t } from '../i18n';
import { getTrace } from './api';

/** Lines PgUp / PgDn scroll the detail by. */
const PAGE_LINES = 5;

const KIND_KEY = { user: 'agents.trajectory.user', assistant: 'agents.trajectory.assistant', tool: 'agents.trajectory.tool' } as const;

const lineOf = (s: AgentTraceStep) => `${t(KIND_KEY[s.kind])}: ${s.label}`;

export interface TrajectoryTabProps {
  /** The selected session's id; absent when none is selected. */
  sessionId?: string;
  /** The session is a Claude session with a transcript to read. */
  available: boolean;
  /** Esc / v / q inside the tab. */
  onClose: () => void;
}

/** The Trajectory tab: the session's steps (prompts, replies, tool calls) on the left, the picked step's detail on the right. */
export function TrajectoryTab({ sessionId, available, onClose }: TrajectoryTabProps) {
  const [picked, setPicked] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLPreElement>(null);
  const state = useAsync(() => (sessionId && available ? getTrace(sessionId) : Promise.resolve(undefined)), [sessionId, available]);
  useRovingList(listRef, '.agents-traj-step');
  useEffect(() => setPicked(0), [sessionId]);
  useEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [picked, sessionId]);

  if (!sessionId) return <Empty title={t('agents.trajectory.noSession')} />;
  if (!available) return <Empty title={t('agents.trajectory.unavailable')} />;
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} />;
  if (!state.data) {
    return (
      <div className="agents-traj-loading">
        <Spinner />
      </div>
    );
  }
  const steps = state.data.steps;
  if (steps.length === 0) return <Empty title={t('agents.trajectory.empty')} />;
  const index = Math.min(picked, steps.length - 1);
  const step = steps[index]!;

  const focusStep = (i: number) => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('.agents-traj-step');
    items?.[Math.max(0, Math.min((items?.length ?? 1) - 1, i))]?.focus();
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const detail = detailRef.current;
    if ((e.key === 'PageUp' || e.key === 'PageDown') && detail) {
      const line = Number.parseFloat(getComputedStyle(detail).lineHeight) || 18;
      detail.scrollBy({ top: (e.key === 'PageUp' ? -1 : 1) * line * PAGE_LINES });
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'j' || e.key === 'k') {
      focusStep(index + (e.key === 'j' ? 1 : -1));
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Escape' || e.key === 'v' || e.key === 'q') {
      onClose();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="agents-traj" onKeyDownCapture={onKeyDownCapture}>
      <ul ref={listRef} className="agents-traj-list" aria-label={t('agents.trajectory.steps')}>
        {steps.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              className={`agents-traj-step agents-traj-${s.kind}${s.error ? ' agents-traj-error' : ''}`}
              aria-pressed={i === index}
              title={lineOf(s)}
              onFocus={() => setPicked(i)}
              onClick={() => setPicked(i)}
            >
              {s.error && (
                <span className="agents-traj-mark" aria-label={t('agents.trajectory.error')}>
                  ✕
                </span>
              )}
              <span className="agents-traj-kind">{t(KIND_KEY[s.kind])}:</span>
              <span className="agents-traj-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <pre ref={detailRef} className="agents-traj-detail" tabIndex={0} aria-label={t('agents.trajectory.detail')}>
        {step.detail || t('agents.trajectory.noDetail')}
      </pre>
    </div>
  );
}
