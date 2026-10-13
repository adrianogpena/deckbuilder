import { createSettingsRegistry, registerDefaultSections } from '@deckbuilder/ui';
import type { Settings } from './api';

export const settingsRegistry = createSettingsRegistry<Settings>();
registerDefaultSections(settingsRegistry);

settingsRegistry.registerSettings([
  {
    id: 'general.autostart',
    kind: 'boolean',
    section: ['general'],
    order: 10,
    label: 'settings.autostart',
    description: 'settings.autostart.hint',
    default: false,
    get: (s) => s.autostart,
    set: (_, autostart) => ({ autostart }),
  },
  {
    id: 'general.closeToTray',
    kind: 'boolean',
    section: ['general'],
    order: 20,
    label: 'settings.closeToTray',
    description: 'settings.closeToTray.hint',
    default: false,
    get: (s) => s.closeToTray,
    set: (_, closeToTray) => ({ closeToTray }),
  },
]);
