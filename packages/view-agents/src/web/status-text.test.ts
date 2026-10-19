import { describe, expect, test } from 'bun:test';
import type { AgentSessionView } from '../protocol';
import { dotKind } from './StatusDot';
import { elapsedText, type StatusT, statusSince } from './status-text';

const MESSAGES: Record<string, string> = {
  'agents.since.justNow': 'just now',
  'agents.since.min': '{n} min',
  'agents.since.h': '{n} h',
  'agents.since.d': '{n} d',
  'agents.since.status.needs-you': 'Waiting for you',
  'agents.since.status.running': 'Working',
};
const t: StatusT = (key, params) => (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k]));

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const s = (status: AgentSessionView['status'], updatedAt: number, statusSince?: number) => ({ status, updatedAt, statusSince }) as AgentSessionView;

describe('statusSince', () => {
  test('formats the waiting tooltip', () => {
    expect(statusSince(s('needs-you', NOW - 2 * 60_000), NOW, t).text).toBe('Waiting for you · 2 min');
  });

  test('prefers statusSince over updatedAt', () => {
    const r = statusSince(s('running', NOW, NOW - 3 * 3_600_000), NOW, t);
    expect(r).toEqual({ label: 'Working', since: '3 h', text: 'Working · 3 h' });
  });

  test('elapsed units', () => {
    expect(elapsedText(30_000, t)).toBe('just now');
    expect(elapsedText(59 * 60_000, t)).toBe('59 min');
    expect(elapsedText(2 * 86_400_000, t)).toBe('2 d');
    expect(statusSince(s('needs-you', NOW + 5000), NOW, t).since).toBe('just now');
  });
});

describe('dotKind', () => {
  test('maps every status', () => {
    expect(dotKind('needs-you')).toBe('attention');
    expect(dotKind('running')).toBe('working');
    expect(dotKind('starting')).toBe('working');
    expect(dotKind('done')).toBe('ok');
    expect(dotKind('idle')).toBe('idle');
    expect(dotKind('stopped')).toBe('stopped');
    expect(dotKind('error')).toBe('error');
    expect(dotKind('exited')).toBe('error');
    expect(dotKind('none')).toBe('none');
  });
});
