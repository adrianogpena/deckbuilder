import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilder/platform';
import { invalid, isRecord, type Routes } from '@deckbuilder/server-core';
import type { HttpRequestDraft } from '@deckbuilder/server-core/protocol';
import { validateDraft, withoutAuthorization } from './http.ts';

export const REST_TABS_MAX = 30;
const ID = /^[\w-]{1,64}$/;
const MAX_TITLE = 200;

export interface RestTab {
  id: string;
  draft: HttpRequestDraft;
  savedId?: string;
  title?: string;
}

export interface RestTabsFile {
  version: 1;
  tabs: RestTab[];
  active?: string;
}

const badTabs = () => invalid('badRestTabs', 'The open requests are not valid.');

/** The open REST tabs as a fresh object; Authorization headers are dropped, anything out of range throws `badRestTabs`. */
export function validateRestTabs(raw: unknown): RestTabsFile {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tabs) || raw.tabs.length > REST_TABS_MAX) throw badTabs();
  const seen = new Set<string>();
  const tabs = raw.tabs.map((tab): RestTab => {
    if (!isRecord(tab) || typeof tab.id !== 'string' || !ID.test(tab.id) || seen.has(tab.id)) throw badTabs();
    seen.add(tab.id);
    let draft: HttpRequestDraft;
    try {
      draft = withoutAuthorization(validateDraft(tab.draft));
    } catch {
      throw badTabs();
    }
    const out: RestTab = { id: tab.id, draft };
    if (tab.savedId !== undefined) {
      if (typeof tab.savedId !== 'string' || !ID.test(tab.savedId)) throw badTabs();
      out.savedId = tab.savedId;
    }
    if (tab.title !== undefined) {
      if (typeof tab.title !== 'string' || tab.title.length > MAX_TITLE) throw badTabs();
      out.title = tab.title;
    }
    return out;
  });
  const file: RestTabsFile = { version: 1, tabs };
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'string' || !seen.has(raw.active)) throw badTabs();
    file.active = raw.active;
  }
  return file;
}

const isTabsFile = (v: unknown) => isRecord(v) && v.version === 1 && Array.isArray(v.tabs);

/** GET/PUT `path`: the REST screen's open tabs in `<dir>/restTabs.json` (never the Authorization value). */
export function restTabsRoutes(opts: { dir: string; path?: string }): Routes {
  const file = join(opts.dir, 'restTabs.json');
  const path = opts.path ?? '/api/rest-tabs';
  let chain: Promise<unknown> = Promise.resolve();
  return {
    [`GET ${path}`]: async () => {
      const stored = await readJsonFile(file, isTabsFile);
      if (!stored) return { version: 1, tabs: [] } satisfies RestTabsFile;
      try {
        return validateRestTabs(stored);
      } catch {
        return { version: 1, tabs: [] } satisfies RestTabsFile;
      }
    },
    [`PUT ${path}`]: async ({ json }) => {
      const next = validateRestTabs(await json());
      const run = chain.then(() => writeJsonAtomic(file, next));
      chain = run.catch(() => {});
      await run;
      return { ok: true };
    },
  };
}
