import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PALETTES } from '@deckbuilderkit/server-core/palettes';
import { type ApiError, errorOf, AppFrame, DialogHost, type CommandDef, CommandPalette, detectLanguage, effectiveKeys, ErrorBanner, GLOBAL, IconButton, isDesktop, KeybindingProvider, LayoutProvider, paletteCommand, type PaletteItem, popOut, popoutView, usePopouts, setLanguage, setViewTitle, Sidebar, Spinner, useAsync, useCommand, useCommandPalette, useHashRoute, useHeartbeat, useKeybindings, useRunCommand, useTheme, useViewTitle, useZoom } from '@deckbuilderkit/ui';
import { APP } from '../../app';
import { api, type Settings } from './api';
import { type MessageKey, t } from './i18n';
import { SettingsModal, viewSettingsSection } from './screens/SettingsModal';
import { views, type ScreenId } from './views';

const navCommandId = (screen: ScreenId) => `nav.${screen}`;
const SETTINGS_COMMAND = 'app.settings';
const KEYS_COMMAND = 'app.keybindings';
const POPOUT_COMMAND = 'window.popOut';

/** Every shortcut of the app; built at render so the labels follow the language. */
function commands(): CommandDef[] {
  const nav = views.nav.flatMap((s) => s.items).map((item, i): CommandDef => ({
    id: navCommandId(item.id), scope: GLOBAL, label: views.label(item.id), keys: [`Ctrl+${i + 1}`], inInput: true,
  }));
  // Settings and keybindings are modals over the screen, not screens; both are VS Code's keys.
  const overlays: CommandDef[] = [
    { id: SETTINGS_COMMAND, scope: GLOBAL, label: t('nav.settings'), keys: ['Ctrl+,'], inInput: true },
    { id: KEYS_COMMAND, scope: GLOBAL, label: t('nav.keys'), keys: ['Ctrl+K Ctrl+S'], inInput: true },
    { id: POPOUT_COMMAND, scope: GLOBAL, label: t('window.popOut'), keys: ['Ctrl+Alt+O'], inInput: true, desktopOnly: true },
  ];
  return [paletteCommand(), ...nav, ...overlays, ...views.keybindings(), ...views.commands()];
}

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
  const shown = useRef<ScreenId>(views.ids[0]!);
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
  const pv = popoutView() as ScreenId | undefined;
  const [routed, rawGo] = useHashRoute(views.ids, views.ids[0]!);
  const screen = pv && views.has(pv) ? pv : routed;
  const go = useCallback((id: ScreenId) => { if (!pv || id === pv) rawGo(id); }, [pv, rawGo]);
  shown.current = screen;
  setLanguage(settings.language ?? detectLanguage());
  return (
    <KeybindingProvider defs={commands()} keymap={settings.keybindings ?? {}} scope={screen}>
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

  const inPopout = popoutView() !== undefined;
  const popouts = usePopouts();
  const popped = popouts.views;
  const viewTitle = useViewTitle();
  useEffect(() => { setViewTitle(undefined); }, [screen]);
  useEffect(() => {
    if (inPopout && views.has(screen)) { document.title = viewTitle ?? views.label(screen); return; }
    document.title = viewTitle ? `${viewTitle} — ${APP.name}` : views.has(screen) ? `${views.label(screen)} · ${APP.name}` : APP.name;
  }, [screen, settings.language, viewTitle]);

  /** Saves at once; resolves to the error when the server rejected the patch as invalid (the stored settings come back), else null. */
  const save = useCallback((patch: Partial<Settings>): Promise<ApiError | null> => {
    setSettings((s) => ({ ...s, ...patch }));
    return api.saveSettings(patch).then(
      () => null,
      (e: unknown) => {
        const err = errorOf(e);
        if (err.kind !== 'invalid') return null; // preferences are best-effort
        api.settings().then(setSettings, () => {});
        return err;
      },
    );
  }, []);

  const navItems = views.nav.flatMap((s) => s.items);
  const defs = commands();
  // The nav list is a constant, so the hooks run in the same order every render.
  const firstFree = (skip?: string) => navItems.find((i) => i.id !== skip && !popped.has(i.id))?.id;
  const goView = (id: ScreenId) => { if (popped.has(id)) void popOut(id, views.label(id)); else go(id); };
  const popOutShown = () => {
    void popOut(screen, views.label(screen)).then((ok) => {
      const free = ok ? firstFree(screen) : undefined;
      if (free) go(free);
    });
  };
  // A view popped out elsewhere (or a hash pointing at one) leaves the main window.
  useEffect(() => {
    if (inPopout || !popped.has(screen)) return;
    const free = firstFree();
    if (free) go(free);
  }, [popped, screen, inPopout]);
  for (const item of navItems) useCommand(defs.find((d) => d.id === navCommandId(item.id))!, () => goView(item.id), { enabled: !inPopout });
  useCommand(defs.find((d) => d.id === SETTINGS_COMMAND)!, () => setOverlay('settings'));
  useCommand(defs.find((d) => d.id === KEYS_COMMAND)!, () => { if (!inPopout) setOverlay('keys'); });
  useCommand(defs.find((d) => d.id === POPOUT_COMMAND)!, popOutShown, { enabled: !inPopout && popouts.supported });
  const keys = useKeybindings();
  const runCommand = useRunCommand();
  const chordOf = (id: string) => (keys ? effectiveKeys(keys.defs, keys.keymap).get(id)?.[0] : undefined);

  const quit = useCallback(() => { api.quit().then(() => setStopped(true)).catch(() => { /* already gone */ }); }, []);
  const nextTheme = kind === 'dark' ? 'light' : 'dark';
  const items = useMemo<PaletteItem[]>(() => {
    const goTo = inPopout ? [] : navItems.map((i): PaletteItem => ({
      id: `go:${i.id}`, group: t('palette.group.go'), label: views.label(i.id), hint: chordOf(navCommandId(i.id)), keywords: [i.id], run: () => goView(i.id),
    }));
    const overlays: PaletteItem[] = [
      { id: 'app:settings', group: t('palette.group.go'), label: t('nav.settings'), hint: chordOf(SETTINGS_COMMAND), keywords: ['settings', 'preferences'], run: () => setOverlay('settings') },
      ...(inPopout ? [] : [{ id: 'app:keys', group: t('palette.group.go'), label: t('nav.keys'), hint: chordOf(KEYS_COMMAND), keywords: ['keybindings', 'shortcuts', 'keys'], run: () => setOverlay('keys') }]),
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
  }, [go, save, quit, nextTheme, settings.language, keys, setOverlay, inPopout, popped]);

  if (stopped) return <div className="boot"><span>{t('app.stopped', { name: APP.name })}</span></div>;

  const sections = views.nav.map((s) => ({ title: t(s.group as MessageKey), items: s.items.map((i) => ({ ...i, label: views.label(i.id), hint: chordOf(navCommandId(i.id)) })) }));

  const popOutChord = chordOf(POPOUT_COMMAND);
  const popOutTitle = popOutChord ? `${t('window.popOut')} (${popOutChord})` : t('window.popOut');
  const gear = (
    <IconButton icon="settings" label={t('nav.settings')} pressed={!!overlay} onClick={() => setOverlay('settings')} />
  );
  const popoutTools = viewSettingsSection(screen) ? gear : undefined;
  const footer = (
        <>
          <IconButton icon={kind === 'dark' ? 'sun' : 'moon'} label={t(`nav.theme.${nextTheme}`)} onClick={() => save({ theme: nextTheme })} />
          {popouts.supported && !inPopout && (
            <IconButton icon="popout" label={popOutTitle} onClick={() => void runCommand(POPOUT_COMMAND)} />
          )}
          {gear}
          <IconButton icon="search" label={t('nav.palette')} onClick={() => palette.setOpen(true)} />
        </>
  );

  return (
    <LayoutProvider layout={settings.layout} icons={settings.icons} mainMenu={settings.mainMenu} dock={settings.dock} layoutIcon={settings.layoutIcon}>
    <DialogHost />
    <views.Providers settings={settings} go={go as (id: string) => void}>
    <AppFrame popout={inPopout} tools={inPopout ? popoutTools : footer} sidebar={inPopout ? undefined : <Sidebar name={APP.name} sections={sections} current={screen} onSelect={goView} footer={footer} popped={popped as ReadonlySet<ScreenId>} poppedHint={t('window.poppedHint')} />}>
      <main className="main">
        <div className="main-view" hidden={!!overlay}>{views.render(screen, { settings, onSave: save, go: go as (id: string) => void })}</div>
        {overlay && (
          <SettingsModal key={overlay} settings={settings} onChange={save} onQuit={() => setStopped(true)} onClose={() => setOverlay(null)} onlyView={inPopout ? screen : undefined} initialSection={inPopout ? undefined : overlay === 'keys' ? 'keyboard.shortcuts' : overlay.startsWith('settings/') ? overlay.slice('settings/'.length) : undefined} />
        )}
      </main>
      {palette.open && <CommandPalette items={items} onClose={() => palette.setOpen(false)} />}
    </AppFrame>
    </views.Providers>
    </LayoutProvider>
  );
}
