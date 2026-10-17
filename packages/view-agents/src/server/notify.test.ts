import { expect, test } from 'bun:test';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import type { AgentsSettings } from '../settings-types.ts';
import { createNotifier, type NotifyToast } from './notify.ts';

const sess = (id: string, status: AgentStatus, external?: boolean) => ({ id, status, title: id, cwd: '/p', external }) as AgentSessionView;

function setup(cfg?: AgentsSettings, shown?: string) {
  const toasts: NotifyToast[] = [];
  const n = createNotifier({
    show: (x) => toasts.push(x),
    link: () => (p) => `app://open/${p}`,
    settings: async () => cfg,
    shown: () => shown,
    text: (status, s) => ({ title: status, body: s.title }),
  });
  return { n, toasts };
}

test('baseline poll is silent, transitions toast with the session link', async () => {
  const { n, toasts } = setup();
  await n.observe([sess('a', 'running'), sess('b', 'idle', true)]);
  await n.observe([sess('a', 'needs-you'), sess('b', 'error', true)]);
  await n.observe([sess('a', 'needs-you'), sess('b', 'error', true)]);
  expect(toasts.map((x) => x.launch)).toEqual(['app://open/agents/a', 'app://open/agents/b']);
});

test('shown session, disabled states and new sessions are skipped', async () => {
  const { n, toasts } = setup({ notifyDone: false }, 'a');
  await n.observe([sess('a', 'running'), sess('b', 'running')]);
  await n.observe([sess('a', 'done'), sess('b', 'done'), sess('c', 'error')]);
  expect(toasts).toEqual([]);
});
