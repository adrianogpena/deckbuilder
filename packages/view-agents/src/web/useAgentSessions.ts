import { useCallback, useEffect, useState } from 'react';
import type { GitStatusMap } from './git';
import { applyAccountPrefs } from './useAccountPrefs';
import { type AgentAccountUsage, type AgentSessionView, type AgentTree, type AgentTreePatch, getTree, listAgentSessions, openAgentsSocket, patchTree, type TreePatchResult } from './api';

/** Sessions with live status and per-account plan usage: initial fetch, then socket frames; reconnects after a drop. */
export function useAgentsFeed(): { sessions: AgentSessionView[]; usage: AgentAccountUsage[]; git: GitStatusMap } {
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  const [usage, setUsage] = useState<AgentAccountUsage[]>([]);
  const [git, setGit] = useState<GitStatusMap>({});
  useEffect(() => {
    let alive = true;
    let close: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const load = () => listAgentSessions().then((s) => alive && setSessions(s)).catch(() => {});
    const retry = () => {
      if (!alive) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };
    const connect = async () => {
      timer = undefined;
      try {
        const c = await openAgentsSocket((f) => {
          delay = 1000;
          if (f.type === 'sessions') setSessions(f.sessions);
          else if (f.type === 'status') setSessions((cur) => cur.map((s) => (f.status[s.id] ? { ...s, status: f.status[s.id] } : s)));
          else if (f.type === 'usage') setUsage(f.accounts);
          else if (f.type === 'git') setGit(f.status);
          else if (f.type === 'accountPrefs') applyAccountPrefs(f.prefs);
        }, () => {
          close = undefined;
          if (!alive) return;
          void load();
          retry();
        });
        if (!alive) { c(); return; }
        close = c;
      } catch {
        retry();
      }
    };
    void load();
    void connect();
    return () => { alive = false; close?.(); if (timer) clearTimeout(timer); };
  }, []);
  return { sessions, usage, git };
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
