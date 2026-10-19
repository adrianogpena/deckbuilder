import { request } from '@deckbuilderkit/ui';
import { openSession, type Ticketed } from '@deckbuilderkit/terminal/session';
import { t } from '../../../i18n';
import type { AgentLaunch, AgentsCapWarn } from '../../../protocol';
import { lifecycleMessage } from '../../api';
import type { PlanProbe, TaskItem } from './flow';

export const loadTasks = (project: string) => request<{ tasks: TaskItem[] }>('GET', '/api/agents/task/list', { project }).then((r) => r.tasks);
export const saveTasks = (project: string, tasks: TaskItem[]) => request<{ ok: boolean }>('PUT', '/api/agents/task/list', { project }, { tasks });
/** The newest plan Claude proposed in the session (`plan: null` until it calls ExitPlanMode). */
export const planOf = (sessionId: string) => request<PlanProbe>('GET', '/api/agents/task/plan', { sessionId });

/**
 * Starts a new Claude session in `dir` with a permission mode and an initial prompt: the usual `terminal/prepare` launch,
 * its launcher args extended with `mode` and `prompt`. Returns undefined when the soft-cap prompt was declined.
 */
export async function startModeSession(opts: { account: string; dir: string; mode: 'plan' | 'acceptEdits'; prompt: string; confirmCap(w: AgentsCapWarn): Promise<boolean> }): Promise<(Ticketed & { sessionId: string }) | undefined> {
  const p = await request<AgentLaunch>('POST', '/api/agents/terminal/prepare', {}, { account: opts.account, dir: opts.dir });
  if (!p.ok) throw new Error(lifecycleMessage(p));
  if (p.warn && !(await opts.confirmCap(p.warn))) return undefined;
  const args = { ...(p.launch.args as Record<string, unknown>), mode: opts.mode, prompt: opts.prompt };
  const ticket = await openSession({ cols: 120, rows: 30, launch: { id: p.launch.id, args }, dir: opts.dir });
  return { ...ticket, sessionId: p.sessionId };
}

export const stateLabel = (state: TaskItem['state']) => t(`panel.task.state.${state}`);
