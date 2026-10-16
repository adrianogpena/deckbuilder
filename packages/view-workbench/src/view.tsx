import { lazy } from 'react';
import { defineView } from '@deckbuilderkit/ui';
import { workbenchClient, type WorkbenchClient } from './client';
import { workbenchCommands } from './commands';
import { en, ptBR } from './i18n';
import { workbenchSettingDefs, type WorkbenchViewSettings } from './settings';
import { FormatterCard, projectsSettingField, ResultsCard, WorkbenchCard } from './settings/cards';

// The editor and its language parsers are a separate chunk, loaded on first visit.
const WorkbenchScreen = lazy(() => import('./WorkbenchScreen').then((m) => ({ default: m.WorkbenchScreen })));

export interface WorkbenchViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The server calls the screen makes. */
  client?: WorkbenchClient;
}

export function workbenchView({ group, order, client = workbenchClient }: WorkbenchViewOptions) {
  return defineView<'workbench', WorkbenchViewSettings, 'nav.workbench'>({
    id: 'workbench',
    nav: { group, icon: 'play', label: 'nav.workbench', order },
    render: ({ settings, onSave }) => <WorkbenchScreen settings={settings} onSave={onSave} client={client} />,
    commands: workbenchCommands,
    settings: { defs: workbenchSettingDefs },
    settingsCards: {
      sections: [
        { path: ['workbench'], order: 60, label: 'settings.section.workbench' },
        { path: ['workbench', 'results'], order: 10, label: 'settings.section.workbench.results' },
        { path: ['workbench', 'sqlFormatter'], order: 20, label: 'settings.section.workbench.sqlFormatter' },
      ],
      cards: { workbench: WorkbenchCard, 'workbench.results': ResultsCard, 'workbench.sqlFormatter': FormatterCard },
      fields: { 'workbench.explorerProjects': projectsSettingField(client) },
    },
    messages: { en, 'pt-BR': ptBR },
  });
}
