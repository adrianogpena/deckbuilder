import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { invalid, notFound } from '@kedalion/server-core';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';
import { projectKey } from '../projects.ts';
import type { PanelRoutes } from './ctx.ts';

const MAX_VIEWED = 5000;
const MAX_COMMENTS = 500;
const MAX_TEXT = 10_000;
const MAX_PATH = 1000;

export interface ReviewComment {
  id: string;
  path: string;
  line: number;
  /** The comment is on a removed line (`line` is the old file's number). */
  removed?: boolean;
  text: string;
}

export interface ReviewState {
  viewed: string[];
  comments: ReviewComment[];
  summary: string;
}

const EMPTY: ReviewState = { viewed: [], comments: [], summary: '' };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The review state if `v` has its shape (limits included), else undefined. */
export function toReviewState(v: unknown): ReviewState | undefined {
  if (!isObject(v) || typeof v.summary !== 'string' || v.summary.length > MAX_TEXT) return undefined;
  if (!Array.isArray(v.viewed) || v.viewed.length > MAX_VIEWED || !Array.isArray(v.comments) || v.comments.length > MAX_COMMENTS) return undefined;
  const viewed: string[] = [];
  for (const p of v.viewed) {
    if (typeof p !== 'string' || !p || p.length > MAX_PATH) return undefined;
    viewed.push(p);
  }
  const comments: ReviewComment[] = [];
  for (const c of v.comments) {
    if (!isObject(c) || typeof c.id !== 'string' || !c.id || typeof c.path !== 'string' || !c.path || c.path.length > MAX_PATH) return undefined;
    if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 0 || typeof c.text !== 'string' || c.text.length > MAX_TEXT) return undefined;
    comments.push({ id: c.id, path: c.path, line: c.line, ...(c.removed === true ? { removed: true } : {}), text: c.text });
  }
  return { viewed, comments, summary: v.summary };
}

export interface ReviewStore {
  fileOf(project: string): string;
  read(project: string): Promise<ReviewState>;
  write(project: string, state: unknown): Promise<boolean>;
}

/** One file per project in `dir`: `<sha1 of the project path>.json`. */
export function createReviewStore(dir: string): ReviewStore {
  const fileOf = (project: string) => join(dir, `${createHash('sha1').update(projectKey(project)).digest('hex')}.json`);
  return {
    fileOf,
    async read(project) {
      const raw = (await readJsonFile(fileOf(project), (v) => isObject(v) && toReviewState(v.review) !== undefined).catch(() => undefined)) as { review: unknown } | undefined;
      return toReviewState(raw?.review) ?? { ...EMPTY };
    },
    async write(project, state) {
      const value = toReviewState(state);
      if (!value) return false;
      await writeJsonAtomic(fileOf(project), { version: 1, project, review: value });
      return true;
    },
  };
}

/** Server routes of the review panel: viewed files, line comments and summary of a project, saved under `<agentsDir>/review`. */
export const routes: PanelRoutes = (ctx) => {
  const store = createReviewStore(join(ctx.agentsDir, 'review'));
  const rootOf = (project: unknown) => {
    const root = typeof project === 'string' && project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return root;
  };
  return {
    'GET /api/agents/review': async ({ query }) => store.read(rootOf(query.get('project'))),
    'PUT /api/agents/review': async ({ query, json }) => {
      const b = await json<{ viewed?: unknown; comments?: unknown; summary?: unknown }>();
      if (!(await store.write(rootOf(query.get('project')), { viewed: b.viewed, comments: b.comments, summary: b.summary }))) throw invalid('review', 'Not a review state');
      return { ok: true };
    },
  };
};
