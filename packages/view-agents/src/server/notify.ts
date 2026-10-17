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

/** Toasts for sessions that turn needs-you, done or error and are not on screen. The first poll is a baseline. */
export function createNotifier(opts: NotifierOptions) {
  let prev: Map<string, AgentStatus> | undefined;
  return {
    async observe(sessions: AgentSessionView[]): Promise<void> {
      const before = prev;
      prev = new Map(sessions.map((s) => [s.id, s.status]));
      if (!before) return;
      const shown = opts.shown();
      const changed = sessions.filter((s) => (s.status === 'needs-you' || s.status === 'done' || s.status === 'error') && before.has(s.id) && before.get(s.id) !== s.status && s.id !== shown);
      if (changed.length === 0) return;
      const cfg = await opts.settings().catch(() => undefined);
      for (const s of changed) {
        const status = s.status as NotifyStatus;
        if (cfg?.[SETTING_KEY[status]] === false) continue;
        const { title, body } = opts.text(status, s);
        const link = opts.link();
        opts.show({ title, body, launch: link ? link(`agents/${s.id}`) : '' });
      }
    },
  };
}
