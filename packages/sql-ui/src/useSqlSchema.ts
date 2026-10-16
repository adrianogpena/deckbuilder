import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type ApiError, errorOf } from '@deckbuilderkit/ui';
import type { DbSchema, DbTableDetails, SqlClient } from './types';

interface Entry {
  data?: DbSchema;
  error?: ApiError;
  loading: boolean;
}

const IDLE: Entry = { loading: false };
const entries = new Map<string, Entry>();
const requests = new Map<string, number>();
const listeners = new Set<() => void>();

const keyOf = (db: string, owner: string | undefined) => `${db}\n${owner ?? ''}`;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const store = (key: string, entry: Entry) => {
  entries.set(key, entry);
  listeners.forEach((listener) => listener());
};

/** Fetches the schema into the cache; a newer request for the same key wins. The old data stays until the new one arrives. */
const fetchSchema = (client: SqlClient, db: string, owner: string | undefined) => {
  const key = keyOf(db, owner);
  const request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  store(key, { data: entries.get(key)?.data, loading: true });
  client.dbSchema(db, owner).then(
    (data) => {
      if (requests.get(key) === request) store(key, { data, loading: false });
    },
    (err) => {
      if (requests.get(key) === request) store(key, { data: entries.get(key)?.data, error: errorOf(err), loading: false });
    },
  );
};

const ensure = (client: SqlClient, db: string, owner: string | undefined) => {
  const entry = entries.get(keyOf(db, owner));
  if (!entry || (!entry.data && !entry.loading)) fetchSchema(client, db, owner);
};

/** Schema of connection `db` (which connects), cached per connection and owner, shared by every consumer. */
export function useSqlSchema(client: SqlClient, db: string | undefined) {
  const [owner, setOwner] = useState<string>();
  const key = db ? keyOf(db, owner) : undefined;
  const entry = useSyncExternalStore(subscribe, () => (key ? (entries.get(key) ?? IDLE) : IDLE));

  useEffect(() => {
    if (db) ensure(client, db, owner);
  }, [db, owner]);

  const sqlSchema = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const table of entry.data?.tables ?? []) out[table.name] = table.columns.map((c) => c.name);
    return out;
  }, [entry.data]);

  return {
    schema: entry.data,
    loading: !!db && (entry.loading || (!entry.data && !entry.error)),
    error: entry.error,
    owner,
    setOwner,
    reload: () => {
      if (!db) return;
      dropDetails(db);
      fetchSchema(client, db, owner);
    },
    sqlSchema,
  };
}

export interface TableDetailsEntry {
  data?: DbTableDetails;
  error?: ApiError;
  loading: boolean;
}

const details = new Map<string, TableDetailsEntry>();
const inflight = new Map<string, Promise<DbTableDetails | undefined>>();
let detailsVersion = 0;
const detailsKey = (db: string, owner: string, name: string) => `${db}\n${owner}\n${name}`;

const storeDetails = (key: string, entry: TableDetailsEntry) => {
  details.set(key, entry);
  detailsVersion++;
  listeners.forEach((listener) => listener());
};

const dropDetails = (db: string) => {
  for (const key of details.keys()) if (key.startsWith(`${db}\n`)) details.delete(key);
  detailsVersion++;
  listeners.forEach((listener) => listener());
};

/** Indexes, constraints and DDL per table of connection `db`, fetched once on `load` and cached until the schema reloads. */
export function useTableDetails(client: SqlClient, db: string | undefined) {
  useSyncExternalStore(subscribe, () => detailsVersion);
  return {
    get: (owner: string, name: string) => (db ? details.get(detailsKey(db, owner, name)) : undefined),
    /** Resolves with the details, or undefined when they failed (the entry then holds the error). */
    load: (owner: string, name: string): Promise<DbTableDetails | undefined> => {
      if (!db) return Promise.resolve(undefined);
      const key = detailsKey(db, owner, name);
      const entry = details.get(key);
      if (entry?.data) return Promise.resolve(entry.data);
      const pending = inflight.get(key);
      if (pending) return pending;
      storeDetails(key, { loading: true });
      const request = client.dbTable(db, owner, name).then(
        (data) => {
          storeDetails(key, { data, loading: false });
          return data;
        },
        (err) => {
          storeDetails(key, { error: errorOf(err), loading: false });
          return undefined;
        },
      );
      inflight.set(key, request);
      void request.finally(() => inflight.delete(key));
      return request;
    },
  };
}
