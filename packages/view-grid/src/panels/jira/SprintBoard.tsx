import { Button } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { Chip } from '../../kit';
import './jira.css';
import type { JiraIssue, SprintData } from './map';

export interface BoardConfig {
  boardId: number;
  columns: string[];
  [key: string]: unknown;
}

function Card({ issue, columns }: { issue: JiraIssue; columns: readonly string[] }) {
  const extra: string[] = [];
  if (columns.includes('type') && issue.type) extra.push(issue.type);
  if (columns.includes('assignee') && issue.assignee) extra.push(issue.assignee);
  return (
    <li className="jira-card">
      <a href={issue.url} target="_blank" rel="noreferrer" title={issue.summary}>
        <span className="jira-card-key">{issue.key}</span> {issue.summary}
      </a>
      {(extra.length > 0 || (columns.includes('points') && issue.points !== null)) && (
        <span className="jira-card-meta">
          {extra.join(' · ')}
          {columns.includes('points') && issue.points !== null && <Chip>{tKey('dash.jira.points', { n: issue.points })}</Chip>}
        </span>
      )}
    </li>
  );
}

export function SprintBoardPanel({ config, data, configure }: { config: BoardConfig; data: SprintData | null | undefined; configure: () => void }) {
  if (!config.boardId) {
    return (
      <div className="kit-empty">
        <p>{tKey('dash.jira.noBoard')}</p>
        <Button size="sm" onClick={configure}>{tKey('grid.setUp')}</Button>
      </div>
    );
  }
  if (!data) return <p className="kit-empty">{tKey('dash.jira.noSprint')}</p>;
  const lanes: [string, JiraIssue[]][] = [
    ['todo', data.todo],
    ['doing', data.doing],
    ['done', data.finished],
  ];
  return (
    <div className="jira">
      <div className="jira-head">
        <strong>{data.name}</strong>
        {data.daysLeft !== null && <span className="muted">{tKey(data.daysLeft === 1 ? 'dash.jira.daysLeft.one' : 'dash.jira.daysLeft.other', { n: data.daysLeft })}</span>}
        <span className="muted">{tKey('dash.jira.progress', { done: data.done, total: data.total })}</span>
      </div>
      {data.goal && <div className="jira-goal">{data.goal}</div>}
      <progress className="jira-progress" max={Math.max(1, data.total)} value={data.done} />
      <div className="jira-lanes">
        {lanes.map(([lane, issues]) => (
          <section key={lane} className="jira-lane">
            <h4 className="jira-group-title">{tKey(`dash.jira.lane.${lane}`)} <span className="muted">{issues.length}</span></h4>
            <ul className="jira-cards">
              {issues.map((i) => <Card key={i.key} issue={i} columns={config.columns} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
