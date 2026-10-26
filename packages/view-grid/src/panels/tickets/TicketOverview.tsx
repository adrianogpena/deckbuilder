import { useState } from 'react';
import { Button, Icon } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import { runAction } from '../../source';
import type { TrackedPr } from '../github/tracked';
import { DescribeDialog } from '../pods/DescribeDialog';
import type { Pod } from '../pods/model';
import { PodLogsDialog } from '../pods/PodLogsDialog';
import { podId, type Ticket } from './model';
import type { TicketLink } from './types';
import './tickets.css';

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

const podsConfig = (p: Pod) => ({ clusters: `${p.context} ${p.namespace} *` });
const target = (p: Pod) => ({ context: p.context, namespace: p.namespace, pod: p.name });

const stateLabel = (pr: TrackedPr) =>
  pr.draft ? tKey('dash.tickets.detail.draft') : tKey(`dash.tickets.pipeline.${pr.state}` as 'dash.tickets.pipeline.merged');

/** One PR as a card: the basics, and the full information (branch, labels, review, every check) on click. */
function PrCard({ pr }: { pr: TrackedPr }) {
  const [open, setOpen] = useState(false);
  const review = pr.reviewDecision ? tKey(REVIEW[pr.reviewDecision] as 'dash.tickets.pipeline.approved') : tKey('dash.tickets.pipeline.noReview');
  return (
    <div className="tickets-card tickets-pr-card">
      <button type="button" className="tickets-card-edit" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>
          {pr.repo}#{pr.number}
        </strong>{' '}
        {pr.title}
        <span className="tickets-detail-dim">
          {' · '}
          {stateLabel(pr)} · {tKey('dash.tickets.pipeline.checks', { passed: pr.checks.passed, total: pr.checks.total })} · {review}
        </span>
      </button>
      {open && (
        <div className="tickets-pr-full">
          <dl>
            <dt>{tKey('dash.tickets.detail.branch')}</dt>
            <dd>{pr.branch}</dd>
            <dt>{tKey('dash.tickets.detail.state')}</dt>
            <dd>{stateLabel(pr)}</dd>
            <dt>{tKey('dash.tickets.detail.review')}</dt>
            <dd>{review}</dd>
            {pr.labels.length > 0 && (
              <>
                <dt>{tKey('dash.tickets.detail.labels')}</dt>
                <dd>{pr.labels.join(', ')}</dd>
              </>
            )}
          </dl>
          <h4>{tKey('dash.tickets.detail.checks')}</h4>
          {pr.checks.details.length > 0 ? (
            <ul className="tickets-detail-checks" aria-label={tKey('dash.tickets.detail.checks')}>
              {pr.checks.details.map((c) => (
                <li key={`${c.name}-${c.url}`} className={`tickets-detail-check tickets-detail-check-${c.state}`}>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}{' '}
                  · {c.state}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tickets-detail-none">{tKey('dash.tickets.detail.noChecks')}</p>
          )}
          <a href={pr.url} target="_blank" rel="noreferrer">
            {tKey('dash.tickets.detail.openPr')}
          </a>
        </div>
      )}
    </div>
  );
}

interface Props {
  ticket: Ticket;
  link?: TicketLink;
  jiraStatus?: string;
  allPods: Pod[];
  config: Record<string, unknown>;
  onChanged(): void;
}

/** The ticket in the Dashboard side panel: description, linked PRs and pods (link or unlink pods by hand). */
export function TicketOverview({ ticket, link, jiraStatus, allPods, config, onChanged }: Props) {
  const [description, setDescription] = useState(ticket.description);
  const [manual, setManual] = useState<string[]>(link?.manualPods ?? ticket.podLinks ?? []);
  const [choice, setChoice] = useState('');
  const [logs, setLogs] = useState<Pod | null>(null);
  const [describe, setDescribe] = useState<{ pod: Pod; text?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const none = <p className="tickets-detail-none">{tKey('dash.tickets.detail.none')}</p>;

  const fromServer = new Set(link?.manualPods ?? []);
  const auto = (link?.pods ?? []).filter((p) => !fromServer.has(podId(p)));
  const byId = new Map([...(link?.pods ?? []), ...allPods].map((p) => [podId(p), p]));
  const manualPods = manual.flatMap((id) => byId.get(id) ?? []);
  const shown = new Set([...auto, ...manualPods].map(podId));
  const candidates = allPods.filter((p) => !shown.has(podId(p)));

  const saveDescription = async () => {
    if (description === ticket.description) return;
    try {
      await runAction('tickets', 'update', config, { id: ticket.id, description });
      setError('');
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
    onChanged();
  };

  const setLinked = async (pod: string, linked: boolean) => {
    const before = manual;
    setManual(linked ? [...manual.filter((x) => x !== pod), pod] : manual.filter((x) => x !== pod));
    try {
      await runAction('tickets', 'link-pod', config, { id: ticket.id, pod, linked });
      setError('');
    } catch (err) {
      setManual(before);
      setError(String((err as Error)?.message ?? err));
    }
    onChanged();
  };

  const showDescribe = async (pod: Pod) => {
    setDescribe({ pod });
    try {
      const text = await runAction<string>('pods', 'describe', podsConfig(pod), target(pod));
      setDescribe({ pod, text });
    } catch (err) {
      setDescribe({ pod, text: String((err as Error)?.message ?? err) });
    }
  };

  const restart = async (pod: Pod) => {
    try {
      await runAction('pods', 'restart', podsConfig(pod), target(pod));
    } catch {
      // the pods panel reports restart failures; here the pod list simply stays as is
    }
  };

  const podRow = (p: Pod, byHand: boolean) => (
    <div key={podId(p)} className="tickets-detail-pod tickets-ov-pod">
      <span className="tickets-detail-podname">
        {p.name} · {p.status} · {tKey('dash.tickets.pipeline.restarts', { n: p.restarts })}
      </span>
      <Button onClick={() => setLogs(p)}>
        <Icon name="log" size={12} /> {tKey('dash.tickets.detail.logs')}
      </Button>
      <Button onClick={() => void showDescribe(p)}>
        <Icon name="file-text" size={12} /> {tKey('dash.tickets.detail.describe')}
      </Button>
      <Button onClick={() => void restart(p)}>
        <Icon name="rotate-ccw" size={12} /> {tKey('dash.tickets.detail.restart')}
      </Button>
      {byHand && (
        <Button onClick={() => void setLinked(podId(p), false)}>
          <Icon name="close" size={12} /> {tKey('dash.tickets.detail.unlinkPod')}
        </Button>
      )}
    </div>
  );

  const projects = [...new Set((link?.prs ?? []).map((pr) => pr.repo))];

  return (
    <div className="tickets-ov">
      {error && <div className="tickets-error" role="alert">{error}</div>}
      <div className="tickets-ov-top">
        <div className="tickets-card">
          <h4>{tKey('dash.tickets.detail.status')}</h4>
          <p>{jiraStatus || <span className="tickets-detail-dim">{tKey('dash.tickets.detail.jiraStatusNone')}</span>}</p>
        </div>
        <div className="tickets-card">
          <h4>{tKey('dash.tickets.detail.description')}</h4>
          {editing ? (
            <textarea
              className="tickets-edit"
              rows={4}
              autoFocus
              value={description}
              placeholder={tKey('dash.tickets.noDescription')}
              aria-label={tKey('dash.tickets.editDescription')}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                setEditing(false);
                void saveDescription();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                setDescription(ticket.description);
                setEditing(false);
              }}
            />
          ) : (
            <button type="button" className="tickets-card-edit" aria-label={tKey('dash.tickets.editDescription')} onClick={() => setEditing(true)}>
              {description || <span className="tickets-detail-dim">{tKey('dash.tickets.noDescription')}</span>}
            </button>
          )}
        </div>
      </div>
      <section>
        <h4>{tKey('dash.tickets.detail.projects')}</h4>
        {projects.length ? <div className="tickets-ov-projects">{projects.map((r) => <Chip key={r}>{r}</Chip>)}</div> : none}
      </section>
      <section>
        <h4>{tKey('dash.tickets.detail.prs')}</h4>
        {link?.prs.length ? link.prs.map((pr) => <PrCard key={pr.url} pr={pr} />) : none}
      </section>
      <section>
        <h4>{tKey('dash.tickets.detail.pods')}</h4>
        {auto.length + manualPods.length === 0 && none}
        {auto.map((p) => podRow(p, false))}
        {manualPods.map((p) => podRow(p, true))}
        {candidates.length > 0 && (
          <div className="tickets-ov-add">
            <select value={choice} aria-label={tKey('dash.tickets.detail.linkPod')} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{tKey('dash.tickets.detail.linkPod')}</option>
              {candidates.map((p) => (
                <option key={podId(p)} value={podId(p)}>
                  {p.name} ({p.cluster})
                </option>
              ))}
            </select>
            <Button
              disabled={!choice}
              onClick={() => {
                void setLinked(choice, true);
                setChoice('');
              }}
            >
              <Icon name="plus" size={12} /> {tKey('dash.tickets.detail.link')}
            </Button>
          </div>
        )}
      </section>
      {logs && <PodLogsDialog pod={logs} onClose={() => setLogs(null)} />}
      {describe && <DescribeDialog title={describe.pod.name} text={describe.text} onClose={() => setDescribe(null)} />}
    </div>
  );
}
