import { lazy } from 'react';
import { defineView } from '@deckbuilderkit/ui';
import { agentsCommands } from './commands';
import { en, ptBR } from './i18n';
import { agentsSettingDefs, type AgentsViewSettings } from './settings';
import { AgentsSettingsCard } from './web/StatuslineCard';
import { usageSettingsOf } from './web/UsageView';

const AgentsScreen = lazy(() => import('./web/AgentsScreen').then((m) => ({ default: m.AgentsScreen })));

export interface AgentsViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
}

export function agentsView({ group, order }: AgentsViewOptions) {
  return defineView<'agents', AgentsViewSettings, 'nav.agents'>({
    id: 'agents',
    nav: { group, icon: 'home', label: 'nav.agents', order },
    render: ({ settings, onSave }) => (
      <AgentsScreen
        mode={settings.agents?.mode}
        resumeOnSelect={settings.agents?.resumeOnSelect === true}
        usageSettings={usageSettingsOf(settings.agents)}
        dnd={settings.agents?.doNotDisturb === true}
        onDnd={(on) => onSave({ agents: { ...settings.agents, doNotDisturb: on } })}
      />
    ),
    commands: agentsCommands,
    settings: { defs: agentsSettingDefs },
    settingsCards: { sections: [{ path: ['agents'], order: 90, label: 'settings.section.agents' }], cards: { agents: AgentsSettingsCard } },
    messages: { en, 'pt-BR': ptBR },
  });
}
