import { defineView, tabCommands } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { TabsScreen } from './TabsScreen';

export const tabsView = defineView<'tabs', Settings>({
  id: 'tabs',
  nav: { group: 'nav.section.main', icon: 'split', label: 'nav.tabs', order: 20 },
  render: ({ settings, onSave }) => <TabsScreen settings={settings} onSave={onSave} />,
  commands: () => tabCommands('tabs'),
  messages: { en: {}, 'pt-BR': {} },
});
