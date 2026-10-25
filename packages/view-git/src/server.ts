import { defineServerView, GIT_SPEC, isRecord, validGroup } from '@kedalion/server-core';
import { gitRoutes } from '@kedalion/server-mods';
import type { GitSection, GitViewState } from './settings';

/** The part of the server settings the Git view owns; the app's `Settings` extends it. */
export interface GitServerSettings {
  /** Git screen: focused project, sidebar fractions and collapsed state, list or tree, closed sections, History panel; checked by `validGitView`. */
  gitView?: GitViewState;
}

const MAX_ID_LENGTH = 64;
const GIT_SECTIONS: unknown[] = ['merge', 'staged', 'changes'];

const validPair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && Math.abs(v[0] + v[1] - 1) <= 0.01
    ? [v[0], v[1]]
    : null;

/** A copy of `raw` when it is a well-formed Git screen state, else null. */
export function validGitView(raw: unknown): GitViewState | null {
  if (!isRecord(raw)) return null;
  const { project, sizes, collapsed, view, closedSections, historyOpen, historySize } = raw as Partial<GitViewState>;
  if (project !== undefined && (typeof project !== 'string' || project.length > MAX_ID_LENGTH)) return null;
  const pair = sizes === undefined ? undefined : validPair(sizes);
  if (sizes !== undefined && !pair) return null;
  if (collapsed !== undefined && typeof collapsed !== 'boolean') return null;
  if (view !== undefined && view !== 'list' && view !== 'tree') return null;
  if (closedSections !== undefined && (!Array.isArray(closedSections) || closedSections.length > GIT_SECTIONS.length || !closedSections.every((s) => GIT_SECTIONS.includes(s)))) return null;
  if (historyOpen !== undefined && typeof historyOpen !== 'boolean') return null;
  if (historySize !== undefined && (typeof historySize !== 'number' || !(historySize >= 0.1 && historySize <= 0.9))) return null;
  return {
    ...(project !== undefined && { project }),
    ...(pair && { sizes: pair }),
    ...(collapsed !== undefined && { collapsed }),
    ...(view !== undefined && { view }),
    ...(closedSections !== undefined && { closedSections: [...new Set<GitSection>(closedSections)] }),
    ...(historyOpen !== undefined && { historyOpen }),
    ...(historySize !== undefined && { historySize }),
  };
}

/** Server half of the Git view: the read-only `/api/git/*` routes over the app's project roots (`ctx.stores.projectRoots`) and the `gitView` settings. */
export const gitServerView = () =>
  defineServerView<GitServerSettings>({
    id: 'git',
    icon: 'git-branch',
    routes: (ctx) => gitRoutes({ roots: ctx.stores.projectRoots as Parameters<typeof gitRoutes>[0]['roots'] }),
    settings: { validate: { gitView: validGitView, git: (raw) => validGroup(raw, GIT_SPEC) } },
  });
