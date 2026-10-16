import { lazy } from 'react';
import { defineView } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';

const RestScreen = lazy(() => import('./RestScreen').then((m) => ({ default: m.RestScreen })));

export const restView = defineView<'rest', Settings>({
  id: 'rest',
  nav: { group: 'nav.section.main', icon: 'send', label: 'nav.rest', order: 60 },
  render: ({ settings, onSave }) => <RestScreen settings={settings} onSave={onSave} />,
  commands: () => [{ id: 'rest.save', scope: 'rest', label: t('keys.rest.save'), keys: ['Ctrl+S'], inInput: true }],
  messages: { en: {}, 'pt-BR': {} },
});
