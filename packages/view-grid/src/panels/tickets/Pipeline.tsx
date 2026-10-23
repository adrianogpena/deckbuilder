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

/** The pipeline strip of a card: branch, PR, pods and hours, each coloured by its stage. */
export function TicketPipeline({ link }: { ticket: Ticket; link?: TicketLink }) {
  if (!link) return null;
  return (
    <div className="tickets-pipe">
      {STAGES.map((s) => {
        const stage: Stage = link.stages[s.id];
        return (
          <div key={s.id} className={`tickets-pipe-seg tickets-pipe-${stage}`} tabIndex={0}>
            <Icon name={s.icon} size={12} />
            <div className="tickets-pipe-card">
              <strong>{tKey(`dash.tickets.pipeline.${s.id}`)}</strong>
              <Detail stage={s.id} link={link} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
