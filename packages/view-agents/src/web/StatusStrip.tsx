import { Icon, StatusBar, type StatusItem } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentSessionView } from './api';
import { stripCounts } from './attention';
import { StatusDot } from './StatusDot';
import './strip.css';

export interface StatusStripProps {
  sessions: AgentSessionView[];
  /** Do not disturb is on (setting `agents.doNotDisturb`). */
  dnd: boolean;
  /** Jump to the longest-waiting session (`nextWaiting`); g7 shows the "No session is waiting for you" toast when none. */
  onJumpWaiting: () => void;
  onToggleDnd: () => void;
}

/** Status bar items of the Agents view (spec S9): working, waiting (click = jump), total; right side the do-not-disturb bell. */
export function StatusStrip({ sessions, dnd, onJumpWaiting, onToggleDnd }: StatusStripProps) {
  const { working, waiting, total } = stripCounts(sessions);
  const items: StatusItem[] = [
    {
      id: 'agents-working',
      align: 'left',
      text: (
        <span className="agents-strip-item">
          <StatusDot status="running" size={6} />
          {t('agents.strip.working', { n: working })}
        </span>
      ),
    },
    {
      id: 'agents-waiting',
      align: 'left',
      title: t('agents.strip.waiting', { n: waiting }),
      onClick: onJumpWaiting,
      text: (
        <span className="agents-strip-item">
          <StatusDot status="needs-you" size={6} />
          {t('agents.strip.waiting', { n: waiting })}
        </span>
      ),
    },
    { id: 'agents-sessions', align: 'left', text: <span className="agents-strip-item">{t('agents.strip.sessions', { n: total })}</span> },
    {
      id: 'agents-dnd',
      align: 'right',
      title: t(dnd ? 'agents.strip.dndOn' : 'agents.strip.dndOff'),
      onClick: onToggleDnd,
      text: (
        <span className={`agents-strip-item agents-strip-dnd${dnd ? ' is-on' : ''}`}>
          <Icon name={dnd ? 'bell-off' : 'bell'} size={12} />
        </span>
      ),
    },
  ];
  return (
    <div className="agents-strip">
      <StatusBar items={items} />
    </div>
  );
}
