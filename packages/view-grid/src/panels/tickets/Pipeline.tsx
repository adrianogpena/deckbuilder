import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import type { TrackedPr } from '../github/tracked';
import type { Ticket } from './model';
import type { Stage, TicketLink } from './types';

const STAGES = [
  { id: 'branch', icon: 'git-branch' },
  { id: 'pr', icon: 'check' },
  { id: 'pods', icon: 'cube' },
  { id: 'hours', icon: 'history' },
] as const;

const REVIEW: Record<string, string> = {
  APPROVED: 'dash.tickets.pipeline.approved',
  CHANGES_REQUESTED: 'dash.tickets.pipeline.changes',
  REVIEW_REQUIRED: 'dash.tickets.pipeline.review',
};

export function prLine(pr: TrackedPr): string {
  const checks = tKey('dash.tickets.pipeline.checks', { passed: pr.checks.passed, total: pr.checks.total });
  const review = pr.reviewDecision ? tKey(REVIEW[pr.reviewDecision] as 'dash.tickets.pipeline.approved') : tKey('dash.tickets.pipeline.noReview');
  return `${pr.repo}#${pr.number} · ${checks} · ${review}`;
}

function Detail({ stage, link }: { stage: (typeof STAGES)[number]['id']; link: TicketLink }) {
  if (stage === 'branch') return <>{link.branches.length ? link.branches.map((b) => <div key={b} className="tickets-pipe-row">{b}</div>) : <div className="tickets-pipe-row">{tKey('dash.tickets.pipeline.none')}</div>}</>;
  if (stage === 'pr') {
    if (!link.prs.length) return <div className="tickets-pipe-row">{tKey('dash.tickets.pipeline.none')}</div>;
    return (
      <>
        {link.prs.map((pr) => (
          <div key={pr.url} className="tickets-pipe-row">
            <a href={pr.url} target="_blank" rel="noreferrer">{prLine(pr)}</a>
            {pr.state !== 'open' && <span> ({tKey(pr.state === 'merged' ? 'dash.tickets.pipeline.merged' : 'dash.tickets.pipeline.closed')})</span>}
          </div>
        ))}
      </>
    );
  }
  if (stage === 'pods') {
    if (!link.pods.length) return <div className="tickets-pipe-row">{tKey('dash.tickets.pipeline.none')}</div>;
    return (
      <>
        {link.pods.map((p) => (
          <div key={`${p.cluster}/${p.name}`} className="tickets-pipe-row">
            {p.name} · {p.status} · {tKey('dash.tickets.pipeline.restarts', { n: p.restarts })}
          </div>
        ))}
      </>
    );
  }
  return <div className="tickets-pipe-row">{link.hours === null ? tKey('dash.tickets.pipeline.none') : tKey('dash.tickets.pipeline.hours', { hours: Math.round(link.hours * 10) / 10 })}</div>;
}

const CARD_WIDTH = 320;

function Segment({ id, icon, stage, link }: { id: (typeof STAGES)[number]['id']; icon: (typeof STAGES)[number]['icon']; stage: Stage; link: TicketLink }) {
  const [at, setAt] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const timer = useRef<number>();
  const show = (el: HTMLElement) => {
    window.clearTimeout(timer.current);
    const r = el.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - CARD_WIDTH - 8)), top: r.top, bottom: r.bottom });
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAt(null), 120);
  };
  const below = at ? at.bottom + 4 : 0;
  const flip = at ? window.innerHeight - below < 220 && at.top > window.innerHeight - below : false;
  return (
    <div
      className={`tickets-pipe-seg tickets-pipe-${stage}`}
      tabIndex={0}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
    >
      <Icon name={icon} size={12} />
      {at &&
        createPortal(
          <div
            className="tickets-pipe-card"
            style={{ left: at.left, ...(flip ? { bottom: window.innerHeight - at.top + 4 } : { top: below }) }}
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
          >
            <strong>{tKey(`dash.tickets.pipeline.${id}`)}</strong>
            <Detail stage={id} link={link} />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The pipeline strip of a card: branch, PR, pods and hours, each coloured by its stage. */
export function TicketPipeline({ link }: { ticket: Ticket; link?: TicketLink }) {
  if (!link) {
    return (
      <div className="tickets-pipe tickets-pipe-loading" aria-hidden="true">
        {STAGES.map((s) => (
          <div key={s.id} className="tickets-pipe-seg">
            <Icon name={s.icon} size={12} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="tickets-pipe">
      {STAGES.map((s) => (
        <Segment key={s.id} id={s.id} icon={s.icon} stage={link.stages[s.id]} link={link} />
      ))}
    </div>
  );
}
