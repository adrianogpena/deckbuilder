import type { ReactNode } from 'react';
import { defineView } from '@deckbuilder/ui';
import { en, ptBR, t } from './i18n';

export interface __VIEW_NAME__ViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
}

export function __VIEW_CAMEL__View({ group, order }: __VIEW_NAME__ViewOptions) {
  return defineView<'__VIEW_ID__', Record<string, never>, 'nav.__VIEW_ID__'>({
    id: '__VIEW_ID__',
    nav: { group, icon: 'home', label: 'nav.__VIEW_ID__', order },
    render: (): ReactNode => (
      <div className="view-__VIEW_ID__">
        <h1>{t('__VIEW_CAMEL__.heading')}</h1>
      </div>
    ),
    messages: { en, 'pt-BR': ptBR },
  });
}
