import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import type { AgentsSettings } from '../settings-types.ts';

export type NotifyStatus = 'needs-you' | 'done' | 'error';

export interface NotifyToast {
  title: string;
  body: string;
  launch: string;
}

export interface NotifierOptions {
  /** Shows a toast; a no-op off Windows. */
  show: (toast: NotifyToast) => void;
  /** App link for a path (`StartContext.link`); toasts have no click target without it. */
  link: () => ((path: string) => string) | undefined;
  settings: () => Promise<AgentsSettings | undefined>;
  /** Id of the session the user is looking at (Agents view open and focused), if any. */
  shown: () => string | undefined;
  text: (status: NotifyStatus, session: AgentSessionView) => { title: string; body: string };
}

/** The server has no UI language: toast titles are English. */
export const NOTIFY_LABEL: Record<NotifyStatus, string> = { 'needs-you': 'Needs you', done: 'Done', error: 'Error' };

const SETTING_KEY = { 'needs-you': 'notifyNeedsYou', done: 'notifyDone', error: 'notifyError' } as const;

export interface Transitions {
  /** Sessions whose status differs from the previous observation; first sight (and return after leaving) is never a change. */
  diff(sessions: AgentSessionView[]): AgentSessionView[];
}

export function createTransitions(): Transitions {
  let prev: Map<string, AgentStatus> | undefined;
  return {
    diff(sessions) {
      const before = prev;
      prev = new Map(sessions.map((s) => [s.id, s.status]));
      if (!before) return [];
      return sessions.filter((s) => before.has(s.id) && before.get(s.id) !== s.status);
    },
  };
}

/** Toasts for sessions that turn needs-you, done or error and are not on screen. The first poll is a baseline. */
export function createNotifier(opts: NotifierOptions, transitions: Transitions = createTransitions()) {
  return {
    async observe(sessions: AgentSessionView[]): Promise<void> {
      const shown = opts.shown();
      const changed = transitions.diff(sessions).filter((s) => (s.status === 'needs-you' || s.status === 'done' || s.status === 'error') && s.id !== shown);
      if (changed.length === 0) return;
      const cfg = await opts.settings().catch(() => undefined);
      if (cfg?.doNotDisturb === true) return;
      for (const s of changed) {
        const status = s.status as NotifyStatus;
        if (cfg?.[SETTING_KEY[status]] === false) continue;
        const { title, body } = opts.text(status, s);
        const link = opts.link();
        opts.show({ title, body, launch: link ? link(`agents/${s.id}${s.account ? `/${s.account}` : ''}`) : '' });
      }
    },
  };
}
