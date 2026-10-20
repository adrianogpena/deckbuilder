import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../i18n';
import { listAgentSessions, type AgentSessionView } from '../../api';
import { fs, relativeTo } from '../code/fs';
import type { WorkspaceApi } from '../../workspace/types';
import { askPrompt, linesOf } from './prompt';

interface Picked {
  path: string;
  code: string;
  lines: string | undefined;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The code selected in a diff or code tab, with its file path and lines; undefined when nothing is selected there. */
async function pickSelection(project: string): Promise<Picked | undefined> {
  const sel = window.getSelection();
  const code = sel?.toString() ?? '';
  const node = sel?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const panel = el?.closest('.agents-panel-diff, .agents-panel-code');
  if (!code.trim() || !panel) return undefined;
  const path = (panel.querySelector('.agents-diff-path, .agents-code-path')?.textContent ?? '').trim();
  if (!path) return undefined;
  const rel = relativeTo(project, path) ?? path;
  const doc = await fs.read(project, rel).then((r) => ('text' in r ? r.text : ''), () => '');
  return { path: rel, code, lines: linesOf(doc, code) };
}

const ACTIONS: Array<{ key: 'panel.ask.fix' | 'panel.ask.explain' | 'panel.ask.refactor' | 'panel.ask.tests'; text: string }> = [
  { key: 'panel.ask.fix', text: 'Fix' },
  { key: 'panel.ask.explain', text: 'Explain' },
  { key: 'panel.ask.refactor', text: 'Refactor' },
  { key: 'panel.ask.tests', text: 'Write tests' },
];

function AskMenu({ project, picked, api, onClose }: { project: string; picked: Picked; api: WorkspaceApi; onClose: () => void }) {
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  const [target, setTarget] = useState('');
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void listAgentSessions().then((all) => {
      const mine = all.filter((s) => s.live && !s.external && norm(s.cwd).startsWith(norm(project)));
      setSessions(mine);
      setTarget((cur) => cur || mine[0]?.id || '');
    }, () => undefined);
  }, [project]);
  useEffect(() => {
    box.current?.focus();
    const off = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', off);
    return () => window.removeEventListener('keydown', off);
  }, [onClose]);

  const send = (action: string) => {
    if (!target || !action.trim()) return;
    api.sendToSession(target, askPrompt(action.trim(), picked.path, picked.lines, picked.code));
    onClose();
  };

  return (
    <div className="agents-ask-backdrop" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className="agents-ask" role="dialog" aria-label={t('panel.ask.title')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="agents-ask-head">
          <strong>{t('panel.ask.title')}</strong>
          <span className="agents-ask-file">{picked.path}{picked.lines ? `:${picked.lines}` : ''}</span>
        </div>
        {sessions.length === 0 ? (
          <p className="agents-empty">{t('panel.review.noSession')}</p>
        ) : (
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('panel.review.sendTo')}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title || s.id.slice(0, 8)}</option>
            ))}
          </select>
        )}
        <div className="agents-ask-actions">
          {ACTIONS.map((a) => (
            <button key={a.key} type="button" disabled={!target} onClick={() => send(a.text)}>
              {t(a.key)}
            </button>
          ))}
          <button type="button" disabled={!target} onClick={() => setCustom(true)}>
            {t('panel.ask.custom')}
          </button>
        </div>
        {custom && (
          <form
            className="agents-ask-custom"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input autoFocus value={text} placeholder={t('panel.ask.customPlaceholder')} onChange={(e) => setText(e.target.value)} />
            <button type="submit" disabled={!text.trim()}>{t('panel.ask.send')}</button>
          </form>
        )}
      </div>
    </div>
  );
}

let open: { unmount(): void; host: HTMLElement } | undefined;

/** Ctrl+L: the Ask agent menu for the code selected in a diff or code tab. */
export async function askAgent(api: WorkspaceApi): Promise<void> {
  const project = api.activeProject;
  if (!project || open) return;
  const picked = await pickSelection(project);
  if (!picked) return;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    open = undefined;
  };
  open = { unmount: close, host };
  root.render(<AskMenu project={project} picked={picked} api={api} onClose={close} />);
}

