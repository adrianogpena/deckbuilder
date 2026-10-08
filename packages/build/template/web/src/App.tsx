import { useCallback, useEffect, useMemo, useState } from 'react';
import { PALETTES } from '@deckbuilder/server-core/palettes';
import { CommandPalette, detectLanguage, ErrorBanner, Icon, type IconName, isDesktop, isTyping, type PaletteItem, setLanguage, Sidebar, Spinner, useAsync, useCommandPalette, useHashRoute, useHeartbeat, useKey, useTheme } from '@deckbuilder/ui';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { type MessageKey, t } from './i18n';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/SettingsScreen';

const SCREENS = ['home', 'settings'] as const;
type ScreenId = (typeof SCREENS)[number];

const NAV: Array<{ title: MessageKey; items: Array<{ id: ScreenId; label: MessageKey; icon: IconName; hint?: string }> }> = [
  {
    title: 'nav.section.main',
    items: [
      { id: 'home', label: 'nav.home', icon: 'home', hint: '1' },
      { id: 'settings', label: 'nav.settings', icon: 'settings', hint: '2' },
    ],
  },
];

// Retrying can't revive a used launch code or a stale token; the user has to open the app again.
const SESSION_ERRORS = ['invalidCode', 'invalidToken'];

/** Loads the settings first, so the first paint already has the right theme and language. */
export function App() {
  const boot = useAsync(() => api.settings(), []);
  if (boot.data?.language) setLanguage(boot.data.language);

  if (boot.error) {
    return <div className="boot"><ErrorBanner error={boot.error} onRetry={SESSION_ERRORS.includes(boot.error.code ?? '') ? undefined : boot.reload} /></div>;
  }
  if (!boot.data) {
    return <div className="boot"><Spinner /> <span className="muted">{t('common.loading')}</span></div>;
  }
  return <Shell initialSettings={boot.data} />;
}

function Shell({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [screen, go] = useHashRoute(SCREENS, 'home');
  const [stopped, setStopped] = useState(false);
  setLanguage(settings.language ?? detectLanguage());
  useHeartbeat();
  const palette = useCommandPalette();

  const { kind } = useTheme(settings);

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

  const quit = useCallback(() => { api.quit().then(() => setStopped(true)).catch(() => { /* already gone */ }); }, []);
  const nextTheme = kind === 'dark' ? 'light' : 'dark';
  const items = useMemo<PaletteItem[]>(() => {
    const goTo = NAV.flatMap((s) => s.items).map((i): PaletteItem => ({
      id: `go:${i.id}`, group: t('palette.group.go'), label: t(i.label), keywords: [i.id], run: () => go(i.id),
    }));
    const toggle: PaletteItem = {
      id: 'theme:toggle', group: t('palette.group.theme'), label: t(`nav.theme.${nextTheme}`), keywords: ['theme', 'dark', 'light'],
      run: () => save({ theme: nextTheme }),
    };
    const palettes = PALETTES.map((p): PaletteItem => ({
      id: `palette:${p.id}`, group: t('palette.group.theme'), label: t('palette.theme', { name: p.label }), keywords: ['theme', p.family, p.kind],
      run: () => save({ theme: p.kind, ...(p.kind === 'dark' ? { paletteDark: p.id } : { paletteLight: p.id }) }),
    }));
    const quitItem: PaletteItem[] = isDesktop ? [] : [{
      id: 'app:quit', group: t('palette.group.app'), label: t('palette.quit', { name: APP.name }), keywords: ['quit', 'exit', 'stop'], run: quit,
    }];
    return [...goTo, toggle, ...palettes, ...quitItem];
  }, [go, save, quit, nextTheme, settings.language]);

  if (stopped) return <div className="boot"><span>{t('app.stopped', { name: APP.name })}</span></div>;

  const sections = NAV.map((s) => ({ title: t(s.title), items: s.items.map((i) => ({ ...i, label: t(i.label) })) }));

  return (
    <div className="app">
      <Sidebar
        name={APP.name}
        sections={sections}
        current={screen}
        onSelect={go}
        footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => save({ theme: nextTheme })} title={t(`nav.theme.${nextTheme}`)}>
              <Icon name={kind === 'dark' ? 'sun' : 'moon'} /> {t(`nav.theme.${nextTheme}`)}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => palette.setOpen(true)} title={t('nav.palette')} aria-label={t('nav.palette')}>
              <Icon name="search" />
            </button>
          </>
        }
      />
      <main className="main">{renderScreen(screen, settings, save, () => setStopped(true))}</main>
      {palette.open && <CommandPalette items={items} onClose={() => palette.setOpen(false)} />}
    </div>
  );
}

function renderScreen(screen: ScreenId, settings: Settings, save: (patch: Partial<Settings>) => void, onQuit: () => void) {
  switch (screen) {
    case 'settings':
      return <SettingsScreen settings={settings} onChange={save} onQuit={onQuit} />;
    default:
      return <Home />;
  }
}
