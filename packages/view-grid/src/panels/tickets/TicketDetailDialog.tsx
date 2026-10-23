import { useState } from 'react';
import { Button, Icon, Modal } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { DescribeDialog } from '../pods/DescribeDialog';
import type { Pod } from '../pods/model';
import { PodLogsDialog } from '../pods/PodLogsDialog';
import type { Ticket } from './model';
import { prLine } from './Pipeline';
import type { TicketLink } from './types';
import './tickets.css';

const podsConfig = (p: Pod) => ({ clusters: `${p.context} ${p.namespace} *` });
const target = (p: Pod) => ({ context: p.context, namespace: p.namespace, pod: p.name });

export function TicketDetailDialog({ ticket, link, onClose }: { ticket: Ticket; link?: TicketLink; onClose: () => void }) {
  const [logs, setLogs] = useState<Pod | null>(null);
  const [describe, setDescribe] = useState<{ pod: Pod; text?: string } | null>(null);
  const none = <p className="tickets-detail-none">{tKey('dash.tickets.detail.none')}</p>;

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

  return (
    <>
      <Modal title={tKey('dash.tickets.detail.title', { key: ticket.key })} onClose={onClose} large>
        <div className="tickets-detail">
          <section>
            <h4>{tKey('dash.tickets.detail.status')}</h4>
            <p>{ticket.status}</p>
          </section>
          <section>
            <h4>{tKey('dash.tickets.detail.description')}</h4>
            <p className="tickets-detail-text">{ticket.description || tKey('dash.tickets.noDescription')}</p>
          </section>
          <section>
            <h4>{tKey('dash.tickets.detail.prs')}</h4>
            {link?.prs.length
              ? link.prs.map((pr) => (
                  <div key={pr.url} className="tickets-detail-pr">
                    <a href={pr.url} target="_blank" rel="noreferrer">
                      {prLine(pr)}
                    </a>
                    <span className="tickets-detail-dim">
                      {' '}
                      {pr.title}
                      {pr.draft ? ` (${tKey('dash.tickets.detail.draft')})` : ''}
                      {pr.state !== 'open' ? ` (${tKey(pr.state === 'merged' ? 'dash.tickets.pipeline.merged' : 'dash.tickets.pipeline.closed')})` : ''}
                    </span>
                    {pr.checks.details.length > 0 && (
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
                    )}
                  </div>
                ))
              : none}
          </section>
          <section>
            <h4>{tKey('dash.tickets.detail.pods')}</h4>
            {link?.pods.length
              ? link.pods.map((p) => (
                  <div key={`${p.cluster}/${p.name}`} className="tickets-detail-pod">
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
                  </div>
                ))
              : none}
          </section>
          <section>
            <h4>{tKey('dash.tickets.detail.hours')}</h4>
            <p>{link?.hours == null ? tKey('dash.tickets.detail.none') : Math.round(link.hours * 10) / 10}</p>
          </section>
        </div>
      </Modal>
      {logs && <PodLogsDialog pod={logs} onClose={() => setLogs(null)} />}
      {describe && <DescribeDialog title={describe.pod.name} text={describe.text} onClose={() => setDescribe(null)} />}
    </>
  );
}
