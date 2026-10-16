import { defineView } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { GridScreen } from './GridScreen';

export const gridView = defineView<'grid', Settings>({
  id: 'grid',
  nav: { group: 'nav.section.main', icon: 'cube', label: 'nav.grid', order: 30 },
  render: ({ settings, onSave }) => <GridScreen settings={settings} onSave={onSave} />,
  messages: { en: {}, 'pt-BR': {} },
});
