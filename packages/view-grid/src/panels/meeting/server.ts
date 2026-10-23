import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { createJsonStore } from '../../json-store';
import { add, emptyMeeting, localDate, parseMeeting, remove, rename, reset, toggle, withDailyReset, type Meeting } from './model';

const stores = new Map<string, ReturnType<typeof createJsonStore<Meeting>>>();

const storeOf = (dataDir: string) => {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore<Meeting>({ dataDir, name: 'meeting', parse: parseMeeting, empty: () => emptyMeeting() });
    stores.set(dataDir, s);
  }
  return s;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const field = (payload: unknown, key: string): string => str(((payload ?? {}) as Record<string, unknown>)[key]);

const edit = (dataDir: string, fn: (m: Meeting) => Meeting) =>
  storeOf(dataDir).update((m) => fn(withDailyReset(m, localDate())));

export const meetingSource = defineSource({
  id: 'meeting',
  fields: [],
  async fetch(_config, ctx) {
    const store = storeOf(ctx.dataDir);
    const today = localDate();
    const current = await store.read();
    return current.lastReset === today ? current : store.update((m) => withDailyReset(m, today));
  },
  actions: {
    toggle: (payload, _c, ctx) => edit(ctx.dataDir, (m) => toggle(m, field(payload, 'name'))),
    add: (payload, _c, ctx) => edit(ctx.dataDir, (m) => add(m, field(payload, 'name'))),
    rename: (payload, _c, ctx) => edit(ctx.dataDir, (m) => rename(m, field(payload, 'from'), field(payload, 'to'))),
    remove: (payload, _c, ctx) => edit(ctx.dataDir, (m) => remove(m, field(payload, 'name'))),
    reset: (_p, _c, ctx) => storeOf(ctx.dataDir).update((m) => reset(m, localDate())),
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'meeting', fields: [], allowMultiple: false }];

export const sources: DataSource<any>[] = [meetingSource];
