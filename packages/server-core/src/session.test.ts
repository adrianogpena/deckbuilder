import { expect, test } from 'bun:test';
import { socketTickets } from './session.ts';

test('a ticket redeems its data once', () => {
  const tickets = socketTickets<{ id: number }>();
  const ticket = tickets.issue({ id: 7 });
  expect(tickets.redeem(ticket)).toEqual({ id: 7 });
  expect(tickets.redeem(ticket)).toBeUndefined();
});

test('an unknown ticket is refused', () => {
  expect(socketTickets().redeem('nope')).toBeUndefined();
});

test('an expired ticket is refused', () => {
  let clock = 0;
  const tickets = socketTickets<string>({ ttlMs: 1000, now: () => clock });
  const ticket = tickets.issue('a');
  clock = 1001;
  expect(tickets.redeem(ticket)).toBeUndefined();
});

test('the 33rd outstanding ticket evicts the first', () => {
  const tickets = socketTickets<number>();
  const first = tickets.issue(0);
  for (let i = 1; i <= 32; i++) tickets.issue(i);
  expect(tickets.redeem(first)).toBeUndefined();
});
