export type StatusTone = 'neutral' | 'info' | 'ok';

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  tone: StatusTone;
  type: string;
  priority: string;
  assignee: string;
  reporter: string;
  updated: string;
  due: string;
  sprint: string;
  points: number | null;
  url: string;
}

export interface FieldIds {
  points?: string;
  sprint?: string;
}

type Raw = Record<string, any>;

/** Chip tone of a status category key: new = neutral, indeterminate = info, done = ok. */
export function statusTone(categoryKey: unknown): StatusTone {
  if (categoryKey === 'done') return 'ok';
  if (categoryKey === 'indeterminate') return 'info';
  return 'neutral';
}

const COLUMN_FIELD: Record<string, string> = {
  type: 'issuetype',
  priority: 'priority',
  status: 'status',
  assignee: 'assignee',
  reporter: 'reporter',
  updated: 'updated',
  due: 'duedate',
};

/** The Jira fields to request: summary and status always, then those of the chosen columns. */
export function requestFields(columns: readonly string[], ids: FieldIds = {}, extra: readonly string[] = []): string[] {
  const out = new Set<string>(['summary', 'status', ...extra]);
  for (const c of columns) {
    if (c === 'sprint') {
      if (ids.sprint) out.add(ids.sprint);
    } else if (c === 'points') {
      if (ids.points) out.add(ids.points);
    } else if (COLUMN_FIELD[c]) out.add(COLUMN_FIELD[c]);
  }
  return [...out];
}

const name = (v: unknown): string => {
  if (!v || typeof v !== 'object') return '';
  const o = v as Raw;
  return String(o.displayName ?? o.name ?? '');
};

/** The sprint name of a sprint custom field value: the active sprint, else the last one. */
export function sprintName(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const nameOf = (s: unknown): { name: string; active: boolean } => {
    if (typeof s === 'string') return { name: /name=([^,\]]*)/.exec(s)?.[1] ?? '', active: /state=ACTIVE/i.test(s) };
    const o = (s ?? {}) as Raw;
    return { name: String(o.name ?? ''), active: o.state === 'active' };
  };
  const all = value.map(nameOf);
  return (all.find((s) => s.active) ?? all[all.length - 1]).name;
}

export const browseUrl = (baseUrl: string, key: string): string => `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;

/** One Jira issue (either API version) as the panels use it. */
export function mapIssue(raw: Raw, baseUrl: string, ids: FieldIds = {}): JiraIssue {
  const f: Raw = raw.fields ?? {};
  const points = ids.points ? f[ids.points] : undefined;
  return {
    key: String(raw.key ?? ''),
    summary: String(f.summary ?? ''),
    status: String(f.status?.name ?? ''),
    tone: statusTone(f.status?.statusCategory?.key),
    type: String(f.issuetype?.name ?? ''),
    priority: String(f.priority?.name ?? ''),
    assignee: name(f.assignee),
    reporter: name(f.reporter),
    updated: String(f.updated ?? ''),
    due: String(f.duedate ?? ''),
    sprint: ids.sprint ? sprintName(f[ids.sprint]) : '',
    points: typeof points === 'number' ? points : null,
    url: browseUrl(baseUrl, String(raw.key ?? '')),
  };
}

/** The story points and sprint field ids from `GET /rest/api/2/field`. */
export function pickFieldIds(list: unknown): FieldIds {
  const out: FieldIds = {};
  if (!Array.isArray(list)) return out;
  for (const f of list as Raw[]) {
    const n = String(f?.name ?? '').toLowerCase();
    if (!out.points && (n === 'story points' || n === 'story point estimate')) out.points = String(f.id);
    if (!out.sprint && n === 'sprint') out.sprint = String(f.id);
  }
  return out;
}

export type GroupBy = 'none' | 'status' | 'assignee' | 'priority';

export interface IssueGroup {
  /** The group value; empty for issues without one. */
  key: string;
  issues: JiraIssue[];
}

/** Issues grouped by a field, groups in order of first appearance; `none` gives one group with key ''. */
export function groupIssues(issues: readonly JiraIssue[], by: GroupBy): IssueGroup[] {
  if (by === 'none') return [{ key: '', issues: [...issues] }];
  const groups = new Map<string, JiraIssue[]>();
  for (const i of issues) {
    const k = i[by];
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, issues: list }));
}

export interface Slice {
  /** Empty for issues without a value. */
  label: string;
  count: number;
}

/** Counts per value of `by`, largest first (ties by label). */
export function breakdown(issues: readonly JiraIssue[], by: 'status' | 'assignee' | 'priority'): Slice[] {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i[by], (counts.get(i[by]) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface SprintData {
  name: string;
  goal: string;
  /** Whole days until the end, never below 0; null without an end date. */
  daysLeft: number | null;
  done: number;
  total: number;
  todo: JiraIssue[];
  doing: JiraIssue[];
  finished: JiraIssue[];
}

export function daysLeft(endDate: unknown, now: number = Date.now()): number | null {
  if (typeof endDate !== 'string') return null;
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

/** A sprint and its issues split into To do / In progress / Done by status category. */
export function mapSprint(sprint: Raw, issues: readonly JiraIssue[], now: number = Date.now()): SprintData {
  const todo = issues.filter((i) => i.tone === 'neutral');
  const doing = issues.filter((i) => i.tone === 'info');
  const finished = issues.filter((i) => i.tone === 'ok');
  return {
    name: String(sprint.name ?? ''),
    goal: String(sprint.goal ?? ''),
    daysLeft: daysLeft(sprint.endDate, now),
    done: finished.length,
    total: issues.length,
    todo,
    doing,
    finished,
  };
}

/** Reload interval of a `refreshMin` value, never below 60 s. */
export const refreshMs = (refreshMin: unknown): number => Math.max(60_000, (Number(refreshMin) || 5) * 60_000);
