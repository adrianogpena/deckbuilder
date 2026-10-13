import { createSettingsRegistry, DEFAULT_SECTIONS, sectionKey } from '@deckbuilder/ui';
import type { Settings } from './api';

/** The built-in sections this app has screens for; add more (e.g. `editor`, `terminal`) as the app grows. */
const SECTIONS = ['general', 'appearance', 'window', 'keyboard', 'keyboard.shortcuts', 'system', 'system.updates'];

export const settingsRegistry = createSettingsRegistry<Settings>();
for (const s of DEFAULT_SECTIONS) if (SECTIONS.includes(sectionKey(s.path))) settingsRegistry.registerSection(s);

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
