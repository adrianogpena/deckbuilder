import { defineServerView, isRecord } from '@deckbuilder/server-core';

/** The part of the server settings the Workbench view owns; the app's `Settings` extends it. */
export interface WorkbenchServerSettings {
  /** Workbench screen: split fractions, column widths, SQL options and Explorer SQL state. */
  workbench?: WorkbenchState;
}

export interface WorkbenchState {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
  /** `'demo'` or the id of a database connection record. */
  source?: string;
  /** Most rows a database query returns, 1 to 100 000. */
  maxRows?: number;
  /** The schema sidebar is open. */
  schema?: boolean;
  /** The SQL history sidebar is open. */
  history?: boolean;
  /** The SQL steps sidebar is open. */
  steps?: boolean;
  /** Width of the SQL steps sidebar in px. */
  stepsWidth?: number;
  /** Project ids allowed to run SQL from the Explorer. */
  explorerProjects?: string[];
  /** How result cells are shown and copied. */
  results?: {
    nullText: string;
    dateFormat: string;
    hideMidnight: boolean;
    timestampFormat: string;
    thousandsSeparator: boolean;
  };
  /** Format of "Copy results": tsv, csv, markdown, json or insert. */
  copyFormat?: 'tsv' | 'csv' | 'markdown' | 'json' | 'insert';
  /** Ask before DROP, TRUNCATE, or a DELETE or UPDATE without WHERE. */
  confirmDestructive?: boolean;
  /** Seconds to wait for a database statement, 0 to 3600; 0 means no limit. */
  queryTimeout?: number;
  historySize?: number;
  /** SQL formatter options; the editor package owns their meaning. */
  format?: Record<string, string | number | boolean>;
  /** The document the Workbench edits; the default script of the connection when omitted. */
  doc?: { kind: 'default' } | { kind: 'file'; project: string; path: string };
}

const WORKBENCH_COLUMNS = ['id', 'name', 'amount', 'date'];

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

/** A copy of `raw` when it is a well-formed workbench state, else null. */
export function validWorkbench(raw: unknown): WorkbenchState | null {
  const r = raw as Partial<WorkbenchState> | null;
  if (typeof r !== 'object' || r === null) return null;
  const out: WorkbenchState = {};
  if (r.sizes !== undefined) {
    const main = validPair(r.sizes?.main);
    const results = validPair(r.sizes?.results);
    if (!main || !results) return null;
    out.sizes = { main, results };
  }
  if (r.widths !== undefined) {
    if (typeof r.widths !== 'object' || r.widths === null || Array.isArray(r.widths)) return null;
    const widths: Record<string, number> = {};
    for (const [id, w] of Object.entries(r.widths)) {
      if (!WORKBENCH_COLUMNS.includes(id) || !Number.isInteger(w) || w < 40 || w > 2000) return null;
      widths[id] = w;
    }
    out.widths = widths;
  }
  if (r.source !== undefined) {
    if (typeof r.source !== 'string' || !/^[\w-]{1,64}$/.test(r.source)) return null;
    out.source = r.source;
  }
  if (r.maxRows !== undefined) {
    if (!Number.isInteger(r.maxRows) || r.maxRows < 1 || r.maxRows > 100_000) return null;
    out.maxRows = r.maxRows;
  }
  if (r.schema !== undefined) {
    if (typeof r.schema !== 'boolean') return null;
    out.schema = r.schema;
  }
  if (r.history !== undefined) {
    if (typeof r.history !== 'boolean') return null;
    out.history = r.history;
  }
  if (r.steps !== undefined) {
    if (typeof r.steps !== 'boolean') return null;
    out.steps = r.steps;
  }
  if (r.stepsWidth !== undefined) {
    if (typeof r.stepsWidth !== 'number' || !Number.isInteger(r.stepsWidth) || r.stepsWidth < 200 || r.stepsWidth > 2000) return null;
    out.stepsWidth = r.stepsWidth;
  }
  if (r.explorerProjects !== undefined) {
    if (!Array.isArray(r.explorerProjects) || r.explorerProjects.length > 1000 || !r.explorerProjects.every((id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id))) return null;
    out.explorerProjects = [...r.explorerProjects];
  }
  if (r.results !== undefined) {
    const x = r.results as Partial<NonNullable<WorkbenchState['results']>> | null;
    if (!isRecord(x)) return null;
    const { nullText, dateFormat, hideMidnight, timestampFormat, thousandsSeparator } = x;
    if (typeof nullText !== 'string' || nullText.length > 64) return null;
    if (typeof dateFormat !== 'string' || dateFormat.length > 64) return null;
    if (typeof timestampFormat !== 'string' || timestampFormat.length > 64) return null;
    if (typeof hideMidnight !== 'boolean' || typeof thousandsSeparator !== 'boolean') return null;
    out.results = { nullText, dateFormat, hideMidnight, timestampFormat, thousandsSeparator };
  }
  if (r.copyFormat !== undefined) {
    if (typeof r.copyFormat !== 'string' || !['tsv', 'csv', 'markdown', 'json', 'insert'].includes(r.copyFormat)) return null;
    out.copyFormat = r.copyFormat;
  }
  if (r.confirmDestructive !== undefined) {
    if (typeof r.confirmDestructive !== 'boolean') return null;
    out.confirmDestructive = r.confirmDestructive;
  }
  if (r.queryTimeout !== undefined) {
    if (typeof r.queryTimeout !== 'number' || !Number.isFinite(r.queryTimeout) || r.queryTimeout < 0 || r.queryTimeout > 3600) return null;
    out.queryTimeout = r.queryTimeout;
  }
  if (r.historySize !== undefined) {
    if (!Number.isInteger(r.historySize) || (r.historySize as number) < 0 || (r.historySize as number) > 10_000) return null;
    out.historySize = r.historySize;
  }
  if (r.format !== undefined) {
    if (!isRecord(r.format)) return null;
    const format: Record<string, string | number | boolean> = {};
    for (const [key, v] of Object.entries(r.format)) {
      if (!/^\w{1,40}$/.test(key) || (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)))) return null;
      format[key] = v;
    }
    out.format = format;
  }
  if (r.doc !== undefined) {
    const d = r.doc as unknown;
    if (!isRecord(d)) return null;
    if (d.kind === 'default') out.doc = { kind: 'default' };
    else if (d.kind === 'file') {
      if (typeof d.project !== 'string' || !/^[\w-]{1,64}$/.test(d.project)) return null;
      if (typeof d.path !== 'string' || d.path.length < 1 || d.path.length > 4096) return null;
      out.doc = { kind: 'file', project: d.project, path: d.path };
    } else return null;
  }
  return out;
}

/** `workbench.historySize` (default 500; 0 = no SQL history). */
export const historySizeOf = (s: WorkbenchServerSettings) => {
  const n = s.workbench?.historySize;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 500;
};

/** Server half of the Workbench view: the `workbench` settings group. The `/api/db/*` routes stay app-mounted (the Explorer's SQL panel uses them too). */
export const workbenchServerView = () =>
  defineServerView<WorkbenchServerSettings>({
    id: 'workbench',
    routes: () => ({}),
    settings: { validate: { workbench: validWorkbench } },
  });
