import { useCallback, useEffect, useState } from 'react';
import { detectLanguage, ErrorBanner, Icon, isTyping, setLanguage, Sidebar, Spinner, useAsync, useHashRoute, useKey } from '@deckbase/ui';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { type MessageKey, t } from './i18n';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/SettingsScreen';

const SCREENS = ['home', 'settings'] as const;
type ScreenId = (typeof SCREENS)[number];

const NAV: Array<{ title: MessageKey; items: Array<{ id: ScreenId; label: MessageKey; icon: string; hint?: string }> }> = [
  {
    title: 'nav.section.main',
    items: [
      { id: 'home', label: 'nav.home', icon: 'home', hint: '1' },
      { id: 'settings', label: 'nav.settings', icon: 'settings', hint: '2' },
    ],
  },
];

/** Loads the settings first, so the first paint already has the right theme and language. */
export function App() {
  const boot = useAsync(() => api.settings(), []);
  if (boot.data?.language) setLanguage(boot.data.language);

  if (boot.error) {
    return <div className="boot"><ErrorBanner error={boot.error} onRetry={boot.reload} /></div>;
  }
  if (!boot.data) {
    return <div className="boot"><Spinner /> <span className="muted">{t('common.loading')}</span></div>;
  }
  return <Shell initialSettings={boot.data} />;
}

function Shell({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [screen, go] = useHashRoute(SCREENS, 'home');
  setLanguage(settings.language ?? detectLanguage());

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const item = NAV.flatMap((s) => s.items).find((i) => i.id === screen);
    document.title = item ? `${t(item.label)} · ${APP.name}` : APP.name;
  }, [screen, settings.language]);

  const save = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    api.saveSettings(patch).catch(() => { /* preferences are best-effort */ });
  }, []);

  // Number keys jump to the matching sidebar entry.
  useKey((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const item = NAV.flatMap((s) => s.items).find((i) => i.hint === e.key);
    if (item) go(item.id);
  });

  const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
  const sections = NAV.map((s) => ({ title: t(s.title), items: s.items.map((i) => ({ ...i, label: t(i.label) })) }));

  return (
    <div className="app">
      <Sidebar
        name={APP.name}
        sections={sections}
        current={screen}
        onSelect={go}
        footer={
          <button className="btn btn-ghost btn-sm" onClick={() => save({ theme: nextTheme })} title={t(`nav.theme.${nextTheme}`)}>
            <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} /> {t(`nav.theme.${nextTheme}`)}
          </button>
        }
      />
      <main className="main">{renderScreen(screen, settings, save)}</main>
    </div>
  );
}

function renderScreen(screen: ScreenId, settings: Settings, save: (patch: Partial<Settings>) => void) {
  switch (screen) {
    case 'settings':
      return <SettingsScreen settings={settings} onChange={save} />;
    default:
      return <Home />;
  }
}
