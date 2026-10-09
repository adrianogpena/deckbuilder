import type { IconName } from '@deckbuilder/ui';
import type { MessageKey } from './i18n';

export const SCREENS = ['home', 'tabs', 'grid', 'explorer', 'workbench', 'rest', 'settings'] as const;
export type ScreenId = (typeof SCREENS)[number];

export const NAV: Array<{ title: MessageKey; items: Array<{ id: ScreenId; label: MessageKey; icon: IconName }> }> = [
  {
    title: 'nav.section.main',
    items: [
      { id: 'home', label: 'nav.home', icon: 'home' },
      { id: 'tabs', label: 'nav.tabs', icon: 'split' },
      { id: 'grid', label: 'nav.grid', icon: 'cube' },
      { id: 'explorer', label: 'nav.explorer', icon: 'folder' },
      { id: 'workbench', label: 'nav.workbench', icon: 'play' },
      { id: 'rest', label: 'nav.rest', icon: 'send' },
      { id: 'settings', label: 'nav.settings', icon: 'settings' },
    ],
  },
];
