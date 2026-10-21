import { describe, expect, test } from 'bun:test';
import { eventDays, expandIcs, parseLine, unfold } from './ics.ts';

const cal = (...events: string[]): string => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map((e) => `BEGIN:VEVENT\n${e}\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');

describe('lines', () => {
  test('unfold joins continuation lines', () => {
    expect(unfold('SUMMARY:Long\r\n  title\r\nLOCATION:Room')).toEqual(['SUMMARY:Long title', 'LOCATION:Room']);
  });
  test('parseLine reads params and quoted colons', () => {
    expect(parseLine('DTSTART;TZID=Europe/Lisbon:20261021T090000')).toEqual({ name: 'DTSTART', params: { TZID: 'Europe/Lisbon' }, value: '20261021T090000' });
    expect(parseLine('ATTENDEE;CN="A: B":mailto:a@b')?.value).toBe('mailto:a@b');
    expect(parseLine('garbage')).toBeNull();
  });
});

describe('single events', () => {
  test('UTC date-time with summary, location, url and escapes', () => {
    const [ev] = expandIcs(cal('DTSTART:20261021T090000Z\nDTEND:20261021T100000Z\nSUMMARY:Plan\\, review\nLOCATION:Room 1\nURL:https://x.test/a'), '2026-10-20', '2026-10-22');
    expect(ev).toEqual({ summary: 'Plan, review', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, location: 'Room 1', url: 'https://x.test/a' });
  });
  test('TZID is read as that zone', () => {
    const [ev] = expandIcs(cal('DTSTART;TZID=America/New_York:20261021T090000\nDTEND;TZID=America/New_York:20261021T100000\nSUMMARY:NY'), '2026-10-20', '2026-10-22');
    expect(ev!.start).toBe('2026-10-21T13:00:00.000Z');
    const [winter] = expandIcs(cal('DTSTART;TZID=America/New_York:20261221T090000\nSUMMARY:NY'), '2026-12-20', '2026-12-22');
    expect(winter!.start).toBe('2026-12-21T14:00:00.000Z');
  });
  test('all-day event end is exclusive', () => {
    const evs = expandIcs(cal('DTSTART;VALUE=DATE:20261021\nDTEND;VALUE=DATE:20261023\nSUMMARY:Trip'), '2026-10-01', '2026-10-31');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ start: '2026-10-21', end: '2026-10-23', allDay: true });
    expect(eventDays(evs[0]!)).toEqual(['2026-10-21', '2026-10-22']);
  });
  test('events outside the window are dropped', () => {
    expect(expandIcs(cal('DTSTART;VALUE=DATE:20261121\nSUMMARY:Later'), '2026-10-01', '2026-10-31')).toHaveLength(0);
  });
  test('an event without SUMMARY or with a bad DTSTART is handled', () => {
    expect(expandIcs(cal('DTSTART:nonsense\nSUMMARY:x'), '2026-10-01', '2026-10-31')).toHaveLength(0);
    expect(expandIcs(cal('DTSTART;VALUE=DATE:20261005'), '2026-10-01', '2026-10-31')[0]!.summary).toBe('');
  });
});

describe('recurrence', () => {
  const days = (text: string, from: string, to: string): string[] => expandIcs(text, from, to).map((e) => e.start.slice(0, 10));

  test('daily with interval and COUNT', () => {
    const text = cal('DTSTART;VALUE=DATE:20261001\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=4\nSUMMARY:d');
    expect(days(text, '2026-09-01', '2026-12-31')).toEqual(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07']);
  });
  test('COUNT includes occurrences before the window', () => {
    const text = cal('DTSTART;VALUE=DATE:20261001\nRRULE:FREQ=DAILY;COUNT=5\nSUMMARY:d');
    expect(days(text, '2026-10-04', '2026-10-31')).toEqual(['2026-10-04', '2026-10-05']);
  });
  test('weekly BYDAY with UNTIL and EXDATE', () => {
    const text = cal('DTSTART;VALUE=DATE:20261005\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261014\nEXDATE;VALUE=DATE:20261007\nSUMMARY:w');
    expect(days(text, '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-12', '2026-10-14']);
  });
  test('weekly every second week', () => {
    const text = cal('DTSTART:20261005T090000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2\nSUMMARY:w');
    expect(days(text, '2026-10-01', '2026-11-10')).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
  });
  test('monthly skips months without the day', () => {
    const text = cal('DTSTART;VALUE=DATE:20260131\nRRULE:FREQ=MONTHLY\nSUMMARY:m');
    expect(days(text, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
  test('a timed recurrence in a zone keeps its wall time across DST', () => {
    const text = cal('DTSTART;TZID=Europe/Lisbon:20261024T100000\nDTEND;TZID=Europe/Lisbon:20261024T110000\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:z');
    const evs = expandIcs(text, '2026-10-20', '2026-11-05');
    expect(evs.map((e) => e.start)).toEqual(['2026-10-24T09:00:00.000Z', '2026-10-31T10:00:00.000Z']);
  });
});
