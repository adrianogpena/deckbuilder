import type { ReactNode } from 'react';
import { defineView } from '@deckbuilderkit/ui';
import { en, ptBR, t } from './i18n';

export interface AgentsViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
}

export function agentsView({ group, order }: AgentsViewOptions) {
  return defineView<'agents', object, 'nav.agents'>({
    id: 'agents',
    nav: { group, icon: 'home', label: 'nav.agents', order },
    render: (): ReactNode => (
      <div className="view-agents">
        <h1>{t('agents.heading')}</h1>
      </div>
    ),
    messages: { en, 'pt-BR': ptBR },
  });
}
