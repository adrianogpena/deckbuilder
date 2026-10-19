import { useEffect, useState } from 'react';
import { TerminalPane } from '@deckbuilderkit/terminal';
import { listSessions } from '@deckbuilderkit/terminal/session';
import { t } from '../../../i18n';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import './style.css';

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** A plain shell in the project folder; the tab's params are `{ session?, dir?, title?, gen? }`. A saved session that is gone shows a restart card. */
function TerminalPanel({ project, params, focused, update }: PanelProps) {
  const host = useAgentsHost();
  const session = text(params.session);
  const gen = typeof params.gen === 'number' ? params.gen : 0;
  const [state, setState] = useState<'checking' | 'ok' | 'ended'>(session ? 'checking' : 'ok');

  useEffect(() => {
    if (!session || state !== 'checking') return;
    let alive = true;
    void listSessions().then(
      (all) => alive && setState(all.some((x) => x.id === session && x.exited === undefined) ? 'ok' : 'ended'),
      () => alive && setState('ok'),
    );
    return () => {
      alive = false;
    };
  }, [session, state]);

  if (state === 'checking') return <div className="agents-panel-terminal" />;
  if (state === 'ended') {
    return (
      <div className="agents-dock-card">
        <h2 className="agents-dock-card-title">{t('workspace.terminal.ended')}</h2>
        <div className="agents-dock-card-actions">
          <button
            type="button"
            className="agents-empty-btn"
            title={t('workspace.terminal.restart')}
            onClick={() => {
              update({ session: undefined, gen: gen + 1 });
              setState('ok');
            }}
          >
            {t('workspace.terminal.restart')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="agents-panel-terminal">
      <TerminalPane
        key={gen}
        session={session}
        dir={text(params.dir) ?? project}
        appKeys={host.appKeys}
        focused={focused}
        onSession={(id) => update({ session: id })}
        onCwd={(cwd) => update({ dir: cwd })}
      />
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'terminal',
  titleKey: 'panel.terminal.title',
  icon: 'terminal',
  placement: 'center',
  addMenu: 'terminal',
  Panel: TerminalPanel,
};
