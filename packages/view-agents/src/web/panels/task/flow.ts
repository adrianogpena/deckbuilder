import { type AgentStatus, STATUS_CATEGORY } from '../../../protocol';

export type TaskState = 'planning' | 'planned' | 'approved' | 'implementing' | 'done';

/** A task of the panel (the server saves the list per project). */
export interface TaskItem {
  id: string;
  text: string;
  state: TaskState;
  planSession: string;
  plan?: string;
  implSession?: string;
  worked?: boolean;
  review?: boolean;
  createdAt: number;
}

export interface PlanProbe {
  plan: string | null;
  answered: boolean;
}

/** The "implement" prompt of an approved plan. */
export const implementPrompt = (plan: string) => `Implement this plan:\n${plan}`;

/**
 * What changed for a task given what the app sees now, or null when nothing did.
 * Planning / planned: a plan nobody answered yet (a newer one after a revision replaces the shown one).
 * Approved / implementing: the implementing session's status; done once it stops working after it worked.
 */
export function advance(task: TaskItem, seen: { plan?: PlanProbe; implStatus?: AgentStatus }): Partial<TaskItem> | null {
  if (task.state === 'planning' || task.state === 'planned') {
    const p = seen.plan;
    if (!p?.plan || p.answered || p.plan === task.plan) return null;
    return { state: 'planned', plan: p.plan };
  }
  if (task.state === 'approved' || task.state === 'implementing') {
    if (!seen.implStatus) return null;
    const working = STATUS_CATEGORY[seen.implStatus] === 'running';
    if (working) return task.worked && task.state === 'implementing' ? null : { state: 'implementing', worked: true };
    return task.worked ? { state: 'done' } : null;
  }
  return null;
}
