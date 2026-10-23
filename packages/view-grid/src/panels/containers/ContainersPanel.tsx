import { useState } from 'react';
import { Button, IconButton } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { relTime } from '../../kit';
import { runAction } from '../../source';
import type { Container } from './model';
import './containers.css';

export interface ContainersConfig {
  engine: string;
  pinned: string;
  showStopped: boolean;
  [key: string]: unknown;
}

export interface ContainersPanelData {
  machineDown: boolean;
  containers: Container[];
}

interface Props {
  config: ContainersConfig;
  data: ContainersPanelData | undefined;
  refresh(): void;
}

export function ContainersPanel({ config, data, refresh }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!data) return null;

  const run = async (key: string, name: string, payload?: unknown) => {
    setBusy(key);
    setError('');
    try {
      await runAction('containers', name, config, payload);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (data.machineDown) {
    return (
      <div className="containers-down">
        <p className="kit-empty">{tKey('dash.containers.machineDown')}</p>
        <Button disabled={busy !== null} onClick={() => void run('machine', 'machine-start')}>
          {tKey('dash.containers.machineStart')}
        </Button>
        {error && <p className="containers-error">{error}</p>}
      </div>
    );
  }

  const rows = data.containers.filter((c) => config.showStopped || c.state === 'running');
  if (rows.length === 0) return <p className="kit-empty">{tKey('dash.containers.empty')}</p>;

  return (
    <div className="containers">
      {error && <p className="containers-error">{error}</p>}
      <ul className="containers-list">
        {rows.map((c) => {
          const running = c.state === 'running';
          return (
            <li key={c.name} className="containers-row">
              <span className="containers-name" title={c.name}>{c.name}</span>
              <span className="containers-meta">{c.created ? relTime(c.created) : ''}</span>
              {!running && (
                <IconButton
                  icon="play"
                  label={tKey('dash.containers.start')}
                  disabled={busy !== null}
                  onClick={() => void run(c.name, 'start', { name: c.name })}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
