import { lazy, type ReactNode, useMemo } from 'react';
import { TerminalOptionsContext } from '@deckbuilder/terminal/options';
import { defineView } from '@deckbuilder/ui';
import { terminalCommands } from './commands';
import { en, ptBR } from './i18n';
import { terminalSettingDefs, type TerminalViewSettings, terminalSettingsOf } from './settings';

// xterm.js is large; the screen loads on first visit.
const TerminalScreen = lazy(() => import('./TerminalScreen').then((m) => ({ default: m.TerminalScreen })));

function TerminalOptions({ settings, children }: { settings: TerminalViewSettings; children: ReactNode }) {
  const options = useMemo(() => terminalSettingsOf(settings), [settings.terminal]);
  return <TerminalOptionsContext.Provider value={options}>{children}</TerminalOptionsContext.Provider>;
}

export interface TerminalViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
}

export function terminalView({ group, order }: TerminalViewOptions) {
  return defineView<'terminal', TerminalViewSettings, 'nav.terminal'>({
    id: 'terminal',
    nav: { group, icon: 'terminal', label: 'nav.terminal', order },
    render: ({ settings, onSave }): ReactNode => <TerminalScreen settings={settings} onSave={onSave} />,
    provider: TerminalOptions,
    commands: terminalCommands,
    settings: { defs: terminalSettingDefs },
    messages: { en, 'pt-BR': ptBR },
  });
}
