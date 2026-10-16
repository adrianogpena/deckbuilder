import { defineView } from '@deckbuilderkit/ui';
import type { Settings } from '../api';
import { Home } from './Home';

export const homeView = defineView<'home', Settings>({
  id: 'home',
  nav: { group: 'nav.section.main', icon: 'home', label: 'nav.home', order: 10 },
  render: () => <Home />,
  messages: { en: {}, 'pt-BR': {} },
});
