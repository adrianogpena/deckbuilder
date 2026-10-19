import type { AgentSessionView, AgentStatus } from '../protocol';

/** Aggregate state of a project or folder (spec S6), highest priority first. */
export type ProjectActivity = 'attention' | 'error' | 'working' | 'running' | 'idle' | 'none';

const PRIORITY: readonly ProjectActivity[] = ['attention', 'error', 'working', 'running', 'idle', 'none'];

/** Exit codes that mean the user stopped the process (SIGINT, SIGTERM, Windows Ctrl+C), not a failure. */
export const STOP_EXIT_CODES: ReadonlySet<number> = new Set([130, 143, 3221225786]);

/** True for an exit code that counts as a failure: non-zero and not a stop. */
export function failedExit(code: number | null | undefined): boolean {
  return typeof code === 'number' && code !== 0 && !STOP_EXIT_CODES.has(code);
}

type Session = Pick<AgentSessionView, 'status' | 'exitCode' | 'live'>;

/** The activity one session adds to its project. */
export function sessionActivity(s: Session): ProjectActivity {
  switch (s.status) {
    case 'needs-you': return 'attention';
    case 'error': return 'error';
    case 'exited': return failedExit(s.exitCode) ? 'error' : 'idle';
    case 'running':
    case 'starting': return 'working';
    case 'done': return 'running';
    case 'idle': return s.live ? 'running' : 'idle';
    default: return 'idle';
  }
}

/** The highest-priority activity of a list of sessions; `none` when empty. */
export function projectActivity(list: readonly Session[]): ProjectActivity {
  let best = PRIORITY.length - 1;
  for (const s of list) best = Math.min(best, PRIORITY.indexOf(sessionActivity(s)));
  return PRIORITY[best]!;
}

/** The status a `StatusDot` draws for an activity. */
export function activityStatus(a: ProjectActivity): AgentStatus | 'none' {
  switch (a) {
    case 'attention': return 'needs-you';
    case 'error': return 'error';
    case 'working': return 'running';
    case 'running': return 'done';
    case 'idle': return 'idle';
    default: return 'none';
  }
}

/** Number of avatar colours (`.agents-avatar--0` … `--9`). */
export const AVATAR_COLOURS = 10;

/** Stable avatar colour index of a project path (case and slash insensitive). */
export function avatarColour(path: string): number {
  const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % AVATAR_COLOURS;
}

/** First letter or digit of a name, upper-cased; '?' when none. */
export function avatarInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toUpperCase() : '?';
}
