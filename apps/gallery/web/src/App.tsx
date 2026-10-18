import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PALETTES } from '@deckbuilderkit/server-core/palettes';
import { CommandPalette, detectLanguage, effectiveKeys, ErrorBanner, GLOBAL, AppFrame, Icon, isDesktop, KeybindingProvider, LayoutProvider, type PaletteItem, setFileAssociations, setLanguage, Sidebar, Spinner, titleWithBadge, ToastProvider,useAsync, useCommand, useCommandPalette, useHashRoute, useHeartbeat, useKeybindings, useRunCommand, useTheme, useTitleBadge,useZen, useZoom } from '@deckbuilderkit/ui';
import { EditorOptionsContext } from '@deckbuilderkit/editor/options';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { commandById, commands, KEYS_COMMAND, navCommandId, SETTINGS_COMMAND } from './commands';
import { type MessageKey, t } from './i18n';
import { appearanceSettingsOf, editorSettingsOf, generalSettingsOf, keyboardSettingsOf, windowSettingsOf } from './settings';
import { SettingsModal } from './screens/SettingsModal';
import { views, type ScreenId } from './views';

// Retrying can't revive a used launch code or a stale token; the user has to open the app again.
const SESSION_ERRORS = ['invalidCode', 'invalidToken'];

// Settings is a modal over the current screen, not a screen; 'keys' opens it at Keyboard › Shortcuts. App links
// (toasts, second instances) still open them with `#/settings` and `#/keys`; `#/settings/<section key>` opens a section.
type Overlay = 'settings' | 'keys' | `settings/${string}`;
const overlayOfHash = (): Overlay | null => {
  const m = /^#\/?(settings|keys)(?:\/([\w.-]+))?\/?$/.exec(window.location.hash);
  if (!m) return null;
  return m[1] === 'settings' && m[2] ? `settings/${m[2]}` : (m[1] as Overlay);
};

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
  const [overlay, setOverlay] = useState(overlayOfHash);
  const shown = useRef<ScreenId>('home');
  // Before useHashRoute, so this listener runs first: it puts the shown screen back in the hash for the router.
  useEffect(() => {
    const take = () => {
      const open = overlayOfHash();
      if (!open) return;
      window.history.replaceState(null, '', `#/${shown.current}`);
      setOverlay(open);
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  const [screen, go] = useHashRoute(views.ids, generalSettingsOf(settings).startScreen as ScreenId);
  shown.current = screen;
  setLanguage(settings.language ?? detectLanguage());
  setFileAssociations(settings.fileAssociations);
  return (
    <KeybindingProvider defs={commands(views)} keymap={settings.keybindings ?? {}} scope={screen} sequenceTimeout={keyboardSettingsOf(settings).chordTimeout}>
      <Main settings={settings} setSettings={setSettings} screen={screen} go={go} overlay={overlay} setOverlay={setOverlay} />
    </KeybindingProvider>
  );
}

interface MainProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  screen: ScreenId;
  go: (screen: ScreenId) => void;
  overlay: Overlay | null;
  setOverlay: (overlay: Overlay | null) => void;
}

function Main({ settings, setSettings, screen, go, overlay, setOverlay }: MainProps) {
  const [stopped, setStopped] = useState(false);
  useHeartbeat();
  const palette = useCommandPalette();

  const { kind } = useTheme(settings);
  useZoom(settings.zoom);
  const appearance = appearanceSettingsOf(settings);
  const editorOptions = useMemo(() => editorSettingsOf(settings), [settings.editor]);
  const windowOptions = useMemo(() => windowSettingsOf(settings), [settings.window]);
  const general = useMemo(() => generalSettingsOf(settings), [settings.general]);

  useEffect(() => {
    const root = document.documentElement;
    const set = (name: string, value: string | undefined) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
    set('--font-sans', appearance.uiFontFamily.trim());
    set('--font-mono', appearance.editorFontFamily.trim());
    set('--editor-font-size', appearance.editorFontSize ? `${appearance.editorFontSize}px` : undefined);
    set('--editor-line-height', appearance.editorLineHeight ? String(appearance.editorLineHeight) : undefined);
    set('--editor-ligatures', appearance.editorLigatures ? 'normal' : 'none');
    root.dataset.reduceMotion = String(appearance.reduceMotion);
  }, [appearance.uiFontFamily, appearance.editorFontFamily, appearance.editorFontSize, appearance.editorLineHeight, appearance.editorLigatures, appearance.reduceMotion]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tabSizing = windowOptions.tabSizing;
    root.dataset.tabClose = windowOptions.tabCloseButton;
    root.dataset.tabIcons = String(windowOptions.tabIcons);
    root.dataset.statusBar = String(windowOptions.statusBar);
  }, [windowOptions]);

  const titleBadge = useTitleBadge();
  useEffect(() => {
    document.title = titleWithBadge(views.has(screen) ? `${views.label(screen)} · ${APP.name}` : APP.name, titleBadge);
  }, [screen, settings.language, titleBadge]);

  const save = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    api.saveSettings(patch).catch(() => { /* preferences are best-effort */ });
  }, []);

  const navItems = views.nav.flatMap((s) => s.items);
  // The nav list is a constant, so the hooks run in the same order every render.
  for (const item of navItems) useCommand(commandById(navCommandId(item.id)), () => go(item.id));
  useCommand(commandById(SETTINGS_COMMAND), () => setOverlay('settings'));
  useCommand(commandById(KEYS_COMMAND), () => setOverlay('keys'));
  const zen = useZen();
  const keys = useKeybindings();
  const runCommand = useRunCommand();
  const chordOf = (id: string) => (keys ? effectiveKeys(keys.defs, keys.keymap).get(id)?.[0] : undefined);

  const quit = useCallback(() => { api.quit().then(() => setStopped(true)).catch(() => { /* already gone */ }); }, []);
  const nextTheme = kind === 'dark' ? 'light' : 'dark';
  const items = useMemo<PaletteItem[]>(() => {
    const goTo = navItems.map((i): PaletteItem => ({
      id: `go:${i.id}`, group: t('palette.group.go'), label: views.label(i.id), hint: chordOf(navCommandId(i.id)), keywords: [i.id], run: () => go(i.id),
    }));
    const overlays: PaletteItem[] = [
      { id: 'app:settings', group: t('palette.group.go'), label: t('nav.settings'), hint: chordOf(SETTINGS_COMMAND), keywords: ['settings', 'preferences'], run: () => setOverlay('settings') },
      { id: 'app:keys', group: t('palette.group.go'), label: t('nav.keys'), hint: chordOf(KEYS_COMMAND), keywords: ['keybindings', 'shortcuts', 'keys'], run: () => setOverlay('keys') },
    ];
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
    const viewItems = (keys?.defs ?? []).filter((d) => d.scope === keys!.scope && d.scope !== GLOBAL).map((d): PaletteItem => ({
      id: `cmd:${d.id}`, group: views.label(keys!.scope), label: d.label, hint: chordOf(d.id), keywords: [d.id], run: () => void runCommand(d.id),
    }));
    return [...goTo, ...overlays, ...viewItems, toggle, ...palettes, ...quitItem];
  }, [go, save, quit, nextTheme, settings.language, keys, setOverlay]);

  if (stopped) return <div className="boot"><span>{t('app.stopped', { name: APP.name })}</span></div>;

  const sections = views.nav.map((s) => ({
    title: t(s.group as MessageKey),
    items: s.items.map((i) => ({ ...i, label: views.label(i.id), hint: chordOf(navCommandId(i.id)) })),
  }));
  const settingsChord = chordOf(SETTINGS_COMMAND);
  const settingsTitle = settingsChord ? `${t('nav.settings')} (${settingsChord})` : t('nav.settings');

  const footer = (
    <>
      <button className={`btn btn-ghost btn-sm${overlay ? ' active' : ''} btn-icon`} onClick={() => setOverlay('settings')} title={settingsTitle} aria-label={settingsTitle}>
        <Icon name="settings" />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => palette.setOpen(true)} title={t('nav.palette')} aria-label={t('nav.palette')}>
        <Icon name="search" />
      </button>
    </>
  );

  return (
    <LayoutProvider layout={settings.layout} icons={settings.icons} mainMenu={settings.mainMenu} dock={settings.dock} layoutIcon={settings.layoutIcon}>
    <ToastProvider defaultTimeout={general.toastDuration}>
      <EditorOptionsContext.Provider value={editorOptions}>
      <views.Providers settings={settings} go={go as (id: string) => void}>
      <AppFrame
        zen={zen}
        tools={footer}
        sidebar={<Sidebar name={APP.name} sections={sections} current={screen} onSelect={go} footer={footer} />}
      >
        <main className="main">{views.render(screen, { settings, onSave: save, go: go as (id: string) => void })}</main>
        {overlay && (
          <SettingsModal key={overlay} settings={settings} onChange={save} onQuit={() => setStopped(true)} onClose={() => setOverlay(null)} initialSection={overlay === 'keys' ? 'keyboard.shortcuts' : overlay.startsWith('settings/') ? overlay.slice('settings/'.length) : undefined} />
        )}
        {palette.open && <CommandPalette items={items} initialQuery={palette.initialQuery} onClose={() => palette.setOpen(false)} />}
      </AppFrame>
      </views.Providers>
      </EditorOptionsContext.Provider>
    </ToastProvider>
    </LayoutProvider>
  );
}
