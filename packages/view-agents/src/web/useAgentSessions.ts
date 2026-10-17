import { useCallback, useEffect, useState } from 'react';
import { type AgentAccountUsage, type AgentSessionView, type AgentTree, type AgentTreePatch, getTree, listAgentSessions, openAgentsSocket, patchTree, type TreePatchResult } from './api';

/** Sessions with live status and per-account plan usage: initial fetch, then socket frames; reconnects after a drop. */
export function useAgentsFeed(): { sessions: AgentSessionView[]; usage: AgentAccountUsage[] } {
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  const [usage, setUsage] = useState<AgentAccountUsage[]>([]);
  useEffect(() => {
    let alive = true;
    let close: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => listAgentSessions().then((s) => alive && setSessions(s)).catch(() => {});
    const connect = async () => {
      try {
        close = await openAgentsSocket((f) => {
          if (f.type === 'sessions') setSessions(f.sessions);
          else if (f.type === 'status') setSessions((cur) => cur.map((s) => (f.status[s.id] ? { ...s, status: f.status[s.id] } : s)));
          else if (f.type === 'usage') setUsage(f.accounts);
        });
      } catch {
        if (alive) timer = setTimeout(connect, 5000);
      }
    };
    void load();
    void connect();
    return () => { alive = false; close?.(); if (timer) clearTimeout(timer); };
  }, []);
  return { sessions, usage };
}

/** Sessions with live status (see `useAgentsFeed`). */
export function useAgentSessions(): AgentSessionView[] {
  return useAgentsFeed().sessions;
}

/** The sidebar tree store: fetched once, replaced by each `PATCH` reply. `patch` resolves to the reply (`error` when refused). */
export function useAgentTree(): { tree: AgentTree | undefined; patch(p: AgentTreePatch): Promise<TreePatchResult> } {
  const [tree, setTree] = useState<AgentTree>();
  useEffect(() => {
    let alive = true;
    getTree().then((r) => {
      const t = (r as unknown as { tree?: AgentTree }).tree ?? r;
      if (alive) setTree(t);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const patch = useCallback(async (p: AgentTreePatch) => {
    const r = await patchTree(p);
    if (r.tree) setTree(r.tree);
    return r;
  }, []);
  return { tree, patch };
}
