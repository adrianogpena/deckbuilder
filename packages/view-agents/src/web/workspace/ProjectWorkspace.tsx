import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyCard } from './EmptyCard';
import { useAgentsHost } from './host';
import { MissingPanel } from './MissingPanel';
import { PanelBoundary } from './PanelBoundary';
import { isDockable, setDocked } from '../sidebar-sections';
import { panelOf } from './registry';
import type { OpenOptions, PanelKind, PanelParams, PanelProps, WorkspaceApi } from './types';

/** What the screen can do to one project's workspace. */
export interface WorkspaceHandle {
  api: WorkspaceApi;
  /** Shows the session's agent panel (replacing any open tool); `terminal` hints the pty to attach to. */
  openAgent(sessionId: string, opts?: { terminal?: string }): void;
  /** Drops the session's agent panel, if it is the shown one. */
  closeAgent(sessionId: string): void;
}

export interface ProjectWorkspaceProps {
  /** Folder of the project. */
  project: string;
  /** Another project's workspace is shown; this one stays mounted. */
  hidden: boolean;
  /** Told when the handle is ready and null when the workspace goes. */
  register(project: string, handle: WorkspaceHandle | null): void;
  /** Told, while shown, the Claude session the workspace shows (undefined: none). */
  onFocusedAgent(project: string, sessionId: string | undefined): void;
}

interface AgentView {
  sessionId: string;
  terminal?: string;
  /** Changes when another session is shown, so the panel remounts; a `/clear` follow keeps it. */
  nonce: number;
}

interface Tool {
  kind: PanelKind;
  params: PanelParams;
}

/** One project's center: the selected session's agent panel, or a tool opened over it until the next selection. */
export function ProjectWorkspace({ project, hidden, register, onFocusedAgent }: ProjectWorkspaceProps) {
  const host = useAgentsHost();
  const hostRef = useRef(host);
  hostRef.current = host;
  const [agent, setAgent] = useState<AgentView>();
  const [tools, setTools] = useState<Tool[]>([]);
  const nonce = useRef(0);
  const tool = tools[tools.length - 1];

  const open = useCallback((kind: PanelKind, params: PanelParams = {}, opts?: OpenOptions): string => {
    const mod = panelOf(kind);
    if (opts?.placement === 'sidebar' && mod && isDockable(mod)) {
      setDocked(kind, true);
      return '';
    }
    if (kind === 'agent') {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
      const terminal = typeof params.terminal === 'string' ? params.terminal : undefined;
      if (sessionId) {
        setAgent((cur) => (cur?.sessionId === sessionId ? { ...cur, ...(terminal ? { terminal } : {}) } : { sessionId, terminal, nonce: ++nonce.current }));
        setTools([]);
      }
      return kind;
    }
    setTools((cur) => {
      const top = cur[cur.length - 1];
      const replace = top && top.kind === kind;
      return [...(replace ? cur.slice(0, -1) : cur), { kind, params }];
    });
    return kind;
  }, []);

  const api = useMemo<WorkspaceApi>(
    () => ({
      open,
      close: (id) => setTools((cur) => cur.filter((x) => x.kind !== id)),
      sendToSession: (sessionId, text) => hostRef.current.sendToSession(sessionId, text),
      activeProject: project,
    }),
    [open, project],
  );

  const handle = useMemo<WorkspaceHandle>(
    () => ({
      api,
      openAgent: (sessionId, opts) => void open('agent', { sessionId, ...(opts?.terminal ? { terminal: opts.terminal } : {}) }),
      closeAgent: (sessionId) => setAgent((cur) => (cur?.sessionId === sessionId ? undefined : cur)),
    }),
    [api, open],
  );

  useEffect(() => {
    register(project, handle);
    return () => register(project, null);
  }, [handle, project, register]);

  const shown = agent?.sessionId;
  useEffect(() => {
    if (!hidden) onFocusedAgent(project, shown);
  }, [hidden, shown, project, onFocusedAgent]);

  const updateAgent = useCallback((patch: PanelParams) => {
    if (typeof patch.sessionId === 'string') setAgent((cur) => cur && { ...cur, sessionId: patch.sessionId as string });
  }, []);
  const updateTool = useCallback((patch: PanelParams) => {
    setTools((cur) => {
      const top = cur[cur.length - 1];
      if (!top) return cur;
      const params = { ...top.params, ...patch };
      for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
      return [...cur.slice(0, -1), { ...top, params }];
    });
  }, []);

  const panelProps = (kind: string, params: PanelParams, active: boolean, update: PanelProps['update']): PanelProps => ({ project, params, api, tabId: kind, visible: active && !hidden, focused: active && !hidden, update });
  const agentMod = panelOf('agent');
  const toolMod = tool ? panelOf(tool.kind) : undefined;

  return (
    <div className="agents-dock" hidden={hidden}>
      <div className="agents-dock-view" hidden={tool !== undefined}>
        <PanelBoundary>
          {agent && agentMod ? (
            <agentMod.Panel key={agent.nonce} {...panelProps('agent', { sessionId: agent.sessionId, terminal: agent.terminal }, !tool, updateAgent)} />
          ) : (
            <EmptyCard onNewSession={() => host.newSession(project)} />
          )}
        </PanelBoundary>
      </div>
      {tool && (
        <div className="agents-dock-view">
          <PanelBoundary key={tool.kind}>
            {toolMod ? <toolMod.Panel {...panelProps(tool.kind, tool.params, true, updateTool)} /> : <MissingPanel kind={tool.kind} />}
          </PanelBoundary>
        </div>
      )}
    </div>
  );
}
