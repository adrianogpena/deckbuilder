import { expect, test } from 'bun:test';
import { uiBroker, UI_SOCKET_PATH } from './ui-broker.ts';

function fakeWs() {
  const sent: any[] = [];
  return { sent, send: (s: string) => void sent.push(JSON.parse(s)) } as any;
}

const sock = (b: ReturnType<typeof uiBroker>) => b.sockets[UI_SOCKET_PATH]!;
const ask = (b: ReturnType<typeof uiBroker>) => b.confirm({ title: 't', message: 'm', danger: true });
const answer = (b: ReturnType<typeof uiBroker>, ws: any, ok: boolean, id = ws.sent.at(-1).id) => sock(b).message(ws, JSON.stringify({ type: 'answer', id, ok }));

test('ticket route issues a redeemable ticket carrying the popout flag', () => {
  const b = uiBroker();
  const { ticket } = b.routes['POST /api/ui/socket-ticket']!({ query: new URLSearchParams('popout=1') } as any) as { ticket: string };
  expect(sock(b).tickets.redeem(ticket)).toEqual({ popout: true });
});

test('sends to the newest non-popout connection and resolves with the answer', async () => {
  const b = uiBroker();
  const a = fakeWs();
  const main = fakeWs();
  const pop = fakeWs();
  sock(b).open(a, { popout: false });
  sock(b).open(main, { popout: false });
  sock(b).open(pop, { popout: true });
  expect(b.connected()).toBe(3);
  const p = ask(b);
  expect(a.sent).toHaveLength(0);
  expect(pop.sent).toHaveLength(0);
  expect(main.sent[0]).toMatchObject({ type: 'confirm', title: 't', message: 'm', danger: true });
  answer(b, main, true);
  expect(await p).toBe(true);
  const q = ask(b);
  answer(b, main, false);
  expect(await q).toBe(false);
});

test('falls back to the newest popout when no other connection exists', async () => {
  const b = uiBroker();
  const pop = fakeWs();
  sock(b).open(pop, { popout: true });
  const p = ask(b);
  expect(pop.sent).toHaveLength(1);
  answer(b, pop, true);
  expect(await p).toBe(true);
});

test('with no connection it reveals, then delivers to the page that connects', async () => {
  const b = uiBroker({ connectTimeoutMs: 1000 });
  let revealed = 0;
  b.setReveal(() => void revealed++);
  const p = ask(b);
  expect(revealed).toBe(1);
  const ws = fakeWs();
  sock(b).open(ws, { popout: false });
  expect(ws.sent).toHaveLength(1);
  answer(b, ws, true);
  expect(await p).toBe(true);
});

test('with no connection after the timeout it resolves false', async () => {
  const b = uiBroker({ connectTimeoutMs: 20 });
  expect(await ask(b)).toBe(false);
});

test('a closing connection hands its request to another one, else false', async () => {
  const b = uiBroker();
  const one = fakeWs();
  const two = fakeWs();
  sock(b).open(one, { popout: false });
  sock(b).open(two, { popout: false });
  const p = ask(b);
  expect(two.sent).toHaveLength(1);
  sock(b).close(two, 1000, '');
  expect(one.sent).toHaveLength(1);
  expect(b.connected()).toBe(1);
  sock(b).close(one, 1000, '');
  expect(await p).toBe(false);
  expect(b.connected()).toBe(0);
});

test('an answer from a connection that was not asked is ignored', async () => {
  const b = uiBroker({ connectTimeoutMs: 50 });
  const one = fakeWs();
  const two = fakeWs();
  sock(b).open(one, { popout: false });
  sock(b).open(two, { popout: false });
  const p = ask(b);
  answer(b, one, true, two.sent[0].id);
  answer(b, two, false);
  expect(await p).toBe(false);
});
