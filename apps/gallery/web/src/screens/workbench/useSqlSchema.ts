import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type ApiError, errorOf } from '@deckbuilder/ui';
import { api, type DbSchema } from '../../api';

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
const fetchSchema = (db: string, owner: string | undefined) => {
  const key = keyOf(db, owner);
  const request = (requests.get(key) ?? 0) + 1;
  requests.set(key, request);
  store(key, { data: entries.get(key)?.data, loading: true });
  api.dbSchema(db, owner).then(
    (data) => {
      if (requests.get(key) === request) store(key, { data, loading: false });
    },
    (err) => {
      if (requests.get(key) === request) store(key, { data: entries.get(key)?.data, error: errorOf(err), loading: false });
    },
  );
};

const ensure = (db: string, owner: string | undefined) => {
  const entry = entries.get(keyOf(db, owner));
  if (!entry || (!entry.data && !entry.loading)) fetchSchema(db, owner);
};

/** Schema of connection `db` (which connects), cached per connection and owner, shared by every consumer. */
export function useSqlSchema(db: string | undefined) {
  const [owner, setOwner] = useState<string>();
  const key = db ? keyOf(db, owner) : undefined;
  const entry = useSyncExternalStore(subscribe, () => (key ? (entries.get(key) ?? IDLE) : IDLE));

  useEffect(() => {
    if (db) ensure(db, owner);
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
      if (db) fetchSchema(db, owner);
    },
    sqlSchema,
  };
}
