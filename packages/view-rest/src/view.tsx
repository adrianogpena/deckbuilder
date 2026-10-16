import { lazy } from 'react';
import { defineView } from '@deckbuilderkit/ui';
import { bindRestClient, type RestClient } from './client';
import { restCommands } from './commands';
import { en, ptBR } from './i18n';
import { restSettingDefs, type RestViewSettings } from './settings';

const RestScreen = lazy(() => import('./RestScreen').then((m) => ({ default: m.RestScreen })));

export interface RestViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The server calls the screen makes. */
  client: RestClient;
}

export function restView({ group, order, client }: RestViewOptions) {
  bindRestClient(client);
  return defineView<'rest', RestViewSettings, 'nav.rest'>({
    id: 'rest',
    nav: { group, icon: 'send', label: 'nav.rest', order },
    render: ({ settings, onSave }) => <RestScreen settings={settings} onSave={onSave} />,
    commands: restCommands,
    settings: { defs: restSettingDefs },
    messages: { en, 'pt-BR': ptBR },
  });
}
