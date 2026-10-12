import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PALETTES } from '@deckbuilder/server-core/palettes';
import { CommandPalette, detectLanguage, effectiveKeys, ErrorBanner, Icon, isDesktop, KeybindingProvider, type PaletteItem, PanelLoading, setFileAssociations, setLanguage, Sidebar, Spinner, ToastProvider, useAsync, useCommand, useCommandPalette, useHashRoute, useHeartbeat, useKeybindings, useTheme, useZoom } from '@deckbuilder/ui';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { commandById, commands, navCommandId } from './commands';
import { t } from './i18n';
import { useZen } from './zen';
import { NAV, SCREENS, type ScreenId } from './nav';
import { ExplorerScreen } from './screens/ExplorerScreen';
import { GridScreen } from './screens/GridScreen';
import { Home } from './screens/Home';
import { SettingsScreen } from './screens/SettingsScreen';
import { TabsScreen } from './screens/TabsScreen';

// The editor and its language parsers are a separate chunk, loaded on first visit.
const WorkbenchScreen = lazy(() => import('./screens/WorkbenchScreen').then((m) => ({ default: m.WorkbenchScreen })));
const RestScreen = lazy(() => import('./screens/RestScreen').then((m) => ({ default: m.RestScreen })));
// xterm.js is large too.
const TerminalScreen = lazy(() => import('./screens/TerminalScreen').then((m) => ({ default: m.TerminalScreen })));

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
  setLanguage(settings.language ?? detectLanguage());
  setFileAssociations(settings.fileAssociations);
  return (
    <KeybindingProvider defs={commands()} keymap={settings.keybindings ?? {}} scope={screen}>
      <Main settings={settings} setSettings={setSettings} screen={screen} go={go} />
    </KeybindingProvider>
  );
}

interface MainProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  screen: ScreenId;
  go: (screen: ScreenId) => void;
}

function Main({ settings, setSettings, screen, go }: MainProps) {
  const [stopped, setStopped] = useState(false);
  useHeartbeat();
  const palette = useCommandPalette();

  const { kind } = useTheme(settings);
  useZoom(settings.zoom);

  useEffect(() => {
    const item = NAV.flatMap((s) => s.items).find((i) => i.id === screen);
    document.title = item ? `${t(item.label)} · ${APP.name}` : APP.name;
  }, [screen, settings.language]);

  const save = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    api.saveSettings(patch).catch(() => { /* preferences are best-effort */ });
  }, []);

  const navItems = NAV.flatMap((s) => s.items);
  // The nav list is a constant, so the hooks run in the same order every render.
  for (const item of navItems) useCommand(commandById(navCommandId(item.id)), () => go(item.id));
  const zen = useZen();
  const keys = useKeybindings();
  const chordOf = (id: string) => (keys ? effectiveKeys(keys.defs, keys.keymap).get(id)?.[0] : undefined);

  const quit = useCallback(() => { api.quit().then(() => setStopped(true)).catch(() => { /* already gone */ }); }, []);
  const nextTheme = kind === 'dark' ? 'light' : 'dark';
  const items = useMemo<PaletteItem[]>(() => {
    const goTo = navItems.map((i): PaletteItem => ({
      id: `go:${i.id}`, group: t('palette.group.go'), label: t(i.label), hint: chordOf(navCommandId(i.id)), keywords: [i.id], run: () => go(i.id),
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
  }, [go, save, quit, nextTheme, settings.language, keys]);

  if (stopped) return <div className="boot"><span>{t('app.stopped', { name: APP.name })}</span></div>;

  const sections = NAV.map((s) => ({
    title: t(s.title),
    items: s.items.filter((i) => i.id !== 'settings').map((i) => ({ ...i, label: t(i.label), hint: chordOf(navCommandId(i.id)) })),
  }));
  const settingsChord = chordOf(navCommandId('settings'));
  const settingsTitle = settingsChord ? `${t('nav.settings')} (${settingsChord})` : t('nav.settings');

  return (
    <ToastProvider>
      <div className={`app nav-collapsed${zen ? ' zen' : ''}`}>
        <Sidebar
          name={APP.name}
          sections={sections}
          current={screen}
          onSelect={go}
          collapsed
          footer={
            <>
              <button className={`btn btn-ghost btn-sm${screen === 'settings' ? ' active' : ''} btn-icon`} onClick={() => go('settings')} title={settingsTitle} aria-label={settingsTitle}>
                <Icon name="settings" />
              </button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => palette.setOpen(true)} title={t('nav.palette')} aria-label={t('nav.palette')}>
                <Icon name="search" />
              </button>
            </>
          }
        />
        <main className="main">{renderScreen(screen, settings, save, () => setStopped(true))}</main>
        {palette.open && <CommandPalette items={items} initialQuery={palette.initialQuery} onClose={() => palette.setOpen(false)} />}
      </div>
    </ToastProvider>
  );
}

function renderScreen(screen: ScreenId, settings: Settings, save: (patch: Partial<Settings>) => void, onQuit: () => void) {
  switch (screen) {
    case 'tabs':
      return <TabsScreen settings={settings} onSave={save} />;
    case 'grid':
      return <GridScreen settings={settings} onSave={save} />;
    case 'explorer':
      return <ExplorerScreen settings={settings} onSave={save} />;
    case 'workbench':
      return <Suspense fallback={<PanelLoading />}><WorkbenchScreen settings={settings} onSave={save} /></Suspense>;
    case 'rest':
      return <Suspense fallback={<PanelLoading />}><RestScreen settings={settings} onSave={save} /></Suspense>;
    case 'terminal':
      return <Suspense fallback={<PanelLoading />}><TerminalScreen settings={settings} onSave={save} /></Suspense>;
    case 'settings':
      return <SettingsScreen settings={settings} onChange={save} onQuit={onQuit} />;
    default:
      return <Home />;
  }
}
