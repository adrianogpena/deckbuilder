import { useEffect, useId, useState } from 'react';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import type { PodEntry } from './model';
import type { PodsConfig } from './PodsPanel';
import './pods.css';

interface ContextsResult {
  contexts: { name: string; namespace?: string }[];
  current?: string;
}

const CACHE_KEY = 'deckbuilder.pods.namespaces';

function readCache(context: string): string[] {
  try {
    const v = (JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, unknown>)[context];
    return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function writeCache(context: string, names: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...all, [context]: names }));
  } catch {
    // storage unavailable; suggestions come from the cluster only
  }
}

/** Context and namespace choices for the entry fields; namespaces show from a local cache and refresh from the cluster in the background. */
export function usePodChoices(config: PodsConfig, context: string, extraNamespaces: readonly string[]) {
  const [contexts, setContexts] = useState<ContextsResult>({ contexts: [] });
  const [namespaces, setNamespaces] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    runAction<ContextsResult>('pods', 'contexts', config).then(
      (r) => live && setContexts(r),
      () => {},
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!context) {
      setNamespaces([]);
      return;
    }
    let live = true;
    setNamespaces(readCache(context));
    runAction<string[]>('pods', 'namespaces', config, { context }).then(
      (r) => {
        if (!live || r.length === 0) return;
        writeCache(context, r);
        setNamespaces(r);
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
  const all = [...new Set([...namespaces, ...extraNamespaces.filter(Boolean)])].sort();
  return { contexts, namespaces: all };
}

/** Context select, namespace input with suggestions and pod name input. */
export function PodEntryFields({
  entry,
  onChange,
  contexts,
  namespaces,
  compact,
}: {
  entry: PodEntry;
  onChange: (next: PodEntry) => void;
  contexts: ContextsResult;
  namespaces: readonly string[];
  compact?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const typed = entry.namespace.toLowerCase();
  const shown = namespaces.filter((n) => n !== entry.namespace && n.toLowerCase().includes(typed));
  const names = contexts.contexts.map((c) => c.name);
  const options = entry.context && !names.includes(entry.context) ? [entry.context, ...names] : names;
  return (
    <div className={compact ? 'pods-entry pods-entry-compact' : 'pods-entry'}>
      <label className="field">
        <span className="mono-label">{tKey('dash.pods.entry.context')}</span>
        <select value={entry.context} onChange={(e) => onChange({ ...entry, context: e.target.value })}>
          {entry.context === '' && <option value="" />}
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="mono-label">{tKey('dash.pods.entry.namespace')}</span>
        <div className="pods-suggest-wrap">
          <input
            value={entry.namespace}
            onChange={(e) => onChange({ ...entry, namespace: e.target.value.trim() })}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
          />
          {open && shown.length > 0 && (
            <ul className="pods-suggest" id={listId}>
              {shown.map((n) => (
                <li key={n}>
                  <button type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ ...entry, namespace: n }); setOpen(false); }}>
                    <span className="menu-label">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <label className="field">
        <span className="mono-label">{tKey('dash.pods.entry.pod')}</span>
        <input value={entry.pod} placeholder={tKey('dash.pods.entry.pod.placeholder')} onChange={(e) => onChange({ ...entry, pod: e.target.value.trim() })} />
      </label>
    </div>
  );
}
