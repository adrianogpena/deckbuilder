import type { PanelKind, PanelModule } from './types';
import { panel as terminal } from '../panels/terminal';
import { panel as agent } from '../panels/agent';
import { panel as changes } from '../panels/changes';
import { panel as diff } from '../panels/diff';
import { panel as review } from '../panels/review';
import { panel as usage } from '../panels/usage';
import { panel as run } from '../panels/run';
import { panel as scratchpad } from '../panels/scratchpad';
import { panel as files } from '../panels/files';
import { panel as code } from '../panels/code';
import { panel as preview } from '../panels/preview';
import { panel as json } from '../panels/json';
import { panel as task } from '../panels/task';
import { panel as notes } from '../panels/notes';
import { panel as trajectory } from '../panels/trajectory';
import { panel as skills } from '../panels/skills';

/** Every panel module (static imports: a new kind is one folder under `panels/` plus one line here). */
export const PANELS: readonly PanelModule[] = [terminal, agent, changes, diff, review, usage, run, scratchpad, files, code, preview, json, task, notes, trajectory, skills];

const byKind = new Map<string, PanelModule>(PANELS.map((p) => [p.kind, p]));

/** The module of a kind; undefined for a kind this build does not know (the workspace shows a "missing panel" card). */
export const panelOf = (kind: string): PanelModule | undefined => byKind.get(kind);

/** The modules that belong in a "+" menu section. */
export const panelsIn = (menu: NonNullable<PanelModule['addMenu']>): PanelModule[] => PANELS.filter((p) => p.addMenu === menu);

export const isPanelKind = (kind: string): kind is PanelKind => byKind.has(kind);

/**
 * What the dock may offer. `sidebarCards`: the sidebar can host tool panels as cards (group g2 sets it true);
 * until then "Move to sidebar" stays hidden.
 */
export const capabilities = { sidebarCards: false };
