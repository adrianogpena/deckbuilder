import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AppearanceFields, DockField, IconsField, LayoutIconField, LayoutField, MainMenuField, ZoomField, type ApiError, detectLanguage, dialogs, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, isModified, parseSettingsQuery, settingDescriptionText, toggleModifiedFilter, SettingLinksProvider, SettingErrorsContext, type SettingLinks, SettingRow, Spinner, useRevealSetting, useRovingList, SETTING_ROW_CONTROLS, useAsync, useKeybindings, type Language, type SettingDef, type SettingsSectionNode, sectionKey } from '@deckbuilderkit/ui';
import { APP } from '../../../app';
import { api, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';
import { en } from '../i18n/en';
import { settingsRegistry } from '../settings';

interface Props {
  settings: Settings;
  /** Saves the patch at once; may resolve to the error the server refused it with. */
  onChange: (patch: Partial<Settings>) => void | Promise<ApiError | null>;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

type Change = (patch: Partial<Settings>) => void;

/** Translates `key` when it is a message, else falls back. */
const tr = (key: string | undefined, fallback?: string): string =>
  !key ? (fallback ?? '') : Object.hasOwn(en, key) ? t(key as MessageKey) : (fallback ?? key);

const sectionLabel = (node: SettingsSectionNode): string => {
  const key = sectionKey(node.path);
  const last = node.path[node.path.length - 1] ?? key;
  return tr(node.label, last.charAt(0).toUpperCase() + last.slice(1));
};

interface FlatNode {
  node: SettingsSectionNode;
  key: string;
  depth: number;
  /** Labels from the top level down to this node. */
  trail: string[];
}

const flatten = (nodes: SettingsSectionNode[], depth = 0, trail: string[] = []): FlatNode[] =>
  nodes.flatMap((node) => {
    const here = [...trail, sectionLabel(node)];
    return [{ node, key: sectionKey(node.path), depth, trail: here }, ...flatten(node.children, depth + 1, here)];
  });

const isUnder = (key: string, parent: string) => key === parent || key.startsWith(`${parent}.`);

interface SectionHit {
  /** The section label matched, so the whole section shows. */
  whole: boolean;
  /** Matching settings directly in the section. */
  ids: string[];
}

/** Structural equality for JSON-like values (arrays, plain objects, primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const PROBLEMS_TAG = '@problems';

/** Takes the `@problems` filter out of a settings search. */
const splitProblemsTag = (query: string): { problems: boolean; rest: string } => {
  const tokens = query.split(/\s+/).filter(Boolean);
  const rest = tokens.filter((tok) => tok.toLowerCase() !== PROBLEMS_TAG);
  return { problems: rest.length !== tokens.length, rest: rest.join(' ') };
};

/** Whether the saved value of a setting fails its schema (wrong type, not one of the enum values, outside min/max). */
function problemOf(def: SettingDef<Settings>, s: Settings): boolean {
  if (def.kind === 'custom' || !def.get) return false;
  const v: unknown = def.get(s);
  if (v === undefined) return false;
  switch (def.kind) {
    case 'boolean': return typeof v !== 'boolean';
    case 'string': return typeof v !== 'string';
    case 'number': return typeof v !== 'number' || !Number.isFinite(v) || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max);
    case 'enum': return !(def.values as readonly unknown[]).includes(v);
  }
}

/** Whether the screen can read and reset the setting (custom ones have no generic getter). */
const handled = (def: SettingDef<Settings>): def is Exclude<SettingDef<Settings>, { kind: 'custom' }> => def.kind !== 'custom';

/** A setting's translated label, or the id when it has none. */
const labelOf = (id: string): string | undefined => {
  const def = settingsRegistry.setting(id);
  return def && tr(def.label, id);
};

/**
 * Searches the schema like VS Code's settings search: a setting matches when its label, rendered description or id
 * holds every word; a section whose label matches (or sits under one that does) shows whole. `@modified` and
 * `@id:<id>` filters AND with the words; while one is on, a matching section shows only its filtered schema rows,
 * since hand-written fields have no schema entry to filter. Returns the sections with hits.
 */
function searchSchema(flat: FlatNode[], query: string, settings: Settings): Map<string, SectionHit> {
  const { problems, rest } = splitProblemsTag(query);
  const { text, modified, ids: only } = parseSettingsQuery(rest);
  const words = norm(text).trim().split(' ').filter(Boolean);
  const filtered = modified || problems || only.length > 0;
  const found = new Map<string, SectionHit>();
  if (words.length === 0 && !filtered) return found;
  const labelKeys: string[] = [];
  for (const { node, key } of flat) {
    const labelHit = words.length > 0 && (words.every((w) => norm(sectionLabel(node)).includes(w)) || labelKeys.some((k) => isUnder(key, k)));
    if (labelHit) labelKeys.push(key);
    const whole = labelHit && !filtered;
    const ids = settingsRegistry
      .settingsIn(node.path)
      .filter((s) => {
        if (modified && !isModified(s, settings)) return false;
        if (problems && !problemOf(s, settings)) return false;
        if (only.length > 0 && !only.includes(s.id)) return false;
        if (labelHit) return true;
        const hay = norm([tr(s.label), settingDescriptionText(tr(s.description), labelOf), s.id].join(' '));
        return words.every((w) => hay.includes(w));
      })
      .map((s) => s.id);
    if (whole || ids.length > 0) found.set(key, { whole, ids });
  }
  return found;
}

/** The root section holding view `viewId`'s settings (by convention named like the view), or undefined when it has none. */
export const viewSettingsSection = (viewId: string): string | undefined =>
  settingsRegistry.sectionTree().some((n) => sectionKey(n.path) === viewId) ? viewId : undefined;

/**
 * Settings as a full page in the app content area (VS Code's settings editor), closed with Escape or the X. Header:
 * title, search, Open settings.json, close. The nav is the schema's section tree; every section, child ones too, is
 * its own page showing only its own settings (a parent with none lists links to its children). Keyboard › Shortcuts
 * holds the keybindings editor, which has its own filter; `initialSection` opens a section directly.
 * Every change saves at once (text on blur or Enter, Escape reverts); a rejected save leaves the old value and shows
 * the error on its row.
 */
export function SettingsModal({ settings, onChange, onQuit, onClose, initialSection, onlyView }: Props & { onClose: () => void; initialSection?: string; onlyView?: string }) {
  const flat = useMemo(() => {
    const tree = settingsRegistry.sectionTree();
    return flatten(onlyView ? tree.filter((n) => sectionKey(n.path) === viewSettingsSection(onlyView)) : tree);
  }, [onlyView]);
  const startSection = onlyView ? flat[0]?.key : initialSection;
  const [section, setSection] = useState(startSection ?? flat[0]?.key ?? 'general');
  // The initial section's ancestors start expanded, so the nav shows it; a view's root starts open.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const path = startSection?.split('.') ?? [];
    return new Set(path.slice(0, onlyView ? path.length : -1).map((_, i) => path.slice(0, i + 1).join('.')));
  });
  const [query, setQuery] = useState('');
  const draft = settings;
  // The server's reason a save was refused, by setting id; shown on the row.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change: Change = (patch) => {
    const next = { ...settings, ...patch };
    const ids = settingsRegistry.settings().filter((d) => handled(d) && !deepEqual(d.get(settings), d.get(next))).map((d) => d.id);
    void Promise.resolve(onChange(patch)).then((err) => {
      if (ids.length === 0) return;
      setErrors((prev) => {
        const out = { ...prev };
        for (const id of ids) {
          if (err) out[id] = errorMessage(err as ApiError);
          else delete out[id];
        }
        return out;
      });
    });
  };
  // Escape returns to the previous view, unless a dialog, a toast or a field used the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-backdrop, .toasts > *')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const hits = useMemo(() => searchSchema(flat, query, draft), [flat, query, draft]);
  const modifiedOnly = parseSettingsQuery(splitProblemsTag(query).rest).modified;
  const problemSettings = useMemo(() => settingsRegistry.settings().filter((d) => (!onlyView || isUnder(sectionKey(d.section), onlyView)) && problemOf(d, draft)), [draft, onlyView]);
  const [fileError, setFileError] = useState<string | null>(null);
  // Picks up edits made to settings.json outside the app.
  useEffect(() => {
    const timer = setInterval(() => {
      api.externalSettings().then((r) => { if (r.changed) onChange(r.settings); }, () => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [onChange]);
  const deepCount = (key: string) => [...hits].reduce((n, [k, h]) => (isUnder(k, key) ? n + h.ids.length : n), 0);
  const total = [...hits.values()].reduce((n, h) => n + h.ids.length, 0);

  /** Whether the section has settings or a card of its own (else a parent lists links to its children). */
  const hasOwn = (key: string): boolean =>
    ['general', 'appearance', 'window', 'editor'].includes(key) || settingsRegistry.settingsIn(key.split('.')).length > 0 || !!false;

  const render = (key: string): ReactNode => {
    switch (key) {
      case 'general': return <GeneralSection settings={draft} onChange={change} onQuit={onQuit} />;
      case 'appearance':
        return (
          <section className="section">
            <div className="card form">
              <AppearanceFields value={draft} onChange={change} />
                <LayoutField value={draft} onChange={change} />
                <MainMenuField value={draft} onChange={change} />
                <DockField value={draft} onChange={change} />
                <IconsField value={draft} onChange={change} />
                <LayoutIconField value={draft} onChange={change} />
            </div>
          </section>
        );
      case 'window':
        return (
          <section className="section">
            <div className="card form">
              <ZoomField value={draft} onChange={change} />
            </div>
          </section>
        );
      case 'keyboard.shortcuts': return <ShortcutsSection settings={settings} onChange={onChange} />;
      case 'system.updates': return <UpdatesCard folder={draft.updateFolder} onFolder={(updateFolder) => change({ updateFolder })} />;
      default: {
        // Sections other packages add: their schema rows.
        const defs = settingsRegistry.settingsIn(key.split('.'));
        return defs.length > 0 ? <SettingRows ids={defs.map((d) => d.id)} settings={draft} onChange={change} /> : null;
      }
    }
  };

  const open = (key: string) => {
    setQuery('');
    setSection(key);
    body.current?.scrollTo({ top: 0 });
  };
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  // A node shows when its ancestors are expanded; while searching, when it or a descendant has hits.
  const visible = (f: FlatNode) =>
    searching
      ? [...hits.keys()].some((k) => isUnder(k, f.key))
      : f.node.path.slice(0, -1).every((_, i) => expanded.has(sectionKey(f.node.path.slice(0, i + 1))));
  const selected = flat.find((f) => f.key === section) ?? flat[0];
  // A node is marked when a setting in it (or under it) differs from its default.
  const modifiedIn = (path: readonly string[]) => settingsRegistry.settingsIn(path, true).some((s) => handled(s) && isModified(s, settings));
  // `#setting.id#` links in descriptions: open the target's section (unless search already shows it), then its row.
  const reveal = useRevealSetting(body);
  // Up/Down/Home/End/PageUp/PageDown between rows; Enter or F2 into a row's control, Escape back to the row.
  useRovingList(body, '[data-setting]', { control: SETTING_ROW_CONTROLS });
  const links = useMemo<SettingLinks>(() => ({
    labelOf,
    onNavigate: (id) => {
      const def = settingsRegistry.setting(id);
      if (!def) return;
      const hit = hits.get(sectionKey(def.section));
      if (!hit || !(hit.whole || hit.ids.includes(id))) {
        setQuery('');
        setSection(sectionKey(def.section));
        setExpanded((prev) => new Set([...prev, ...def.section.slice(0, -1).map((_, i) => sectionKey(def.section.slice(0, i + 1)))]));
      }
      reveal(id);
    },
  }), [hits, reveal]);

  return (
    <div className="settings-screen">
      <SettingLinksProvider value={links}>
      <SettingErrorsContext.Provider value={errors}>
      <header className="settings-head">
        <h2>{t('settings.title')}</h2>
          <div className="settings-nav-search-box">
          <input
            className="settings-search settings-nav-search"
            type="search"
            value={query}
            placeholder={t('settings.search')}
            aria-label={t('settings.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              } else if (e.key === 'ArrowDown') {
                // Like VS Code: down from the search box goes into the settings.
                const first = body.current?.querySelector<HTMLElement>(`.field :is(${CONTROLS})`);
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          <button
            type="button"
            className="settings-nav-filter"
            title={t('settings.search.modified')}
            aria-label={t('settings.search.modified')}
            aria-pressed={modifiedOnly}
            onClick={() => setQuery(toggleModifiedFilter)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />
            </svg>
          </button>
          </div>
          {searching && <span className="settings-count">{t(total === 1 ? 'settings.search.count.one' : 'settings.search.count', { n: total })}</span>}
        <span className="settings-head-spacer" />
        {fileError && <span className="tone-err small">{fileError}</span>}
        <button type="button" className="btn btn-sm" title={t('settings.openFile')} onClick={() => { setFileError(null); api.openSettingsFile().catch((err) => setFileError(errorMessage(errorOf(err)))); }}>{t('settings.openFile')}</button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" title={t('settings.close')} aria-label={t('settings.close')} onClick={onClose}>✕</button>
      </header>
      {problemSettings.length > 0 && (
        <div className="settings-problems" style={{ padding: '8px 16px' }}>
          <span className="tone-err">{t('settings.problems.banner', { n: problemSettings.length })}</span>
          <div className="settings-links">
            {problemSettings.map((d) => (
              <button key={d.id} type="button" className="setting-link" onClick={() => links.onNavigate(d.id)}>{tr(d.label, d.id)}</button>
            ))}
            <button type="button" className="setting-link" onClick={() => setQuery(PROBLEMS_TAG)}>{PROBLEMS_TAG}</button>
          </div>
        </div>
      )}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {flat.filter(visible).map((f) => {
            const parent = f.node.children.length > 0;
            const isOpen = searching || expanded.has(f.key);
            const active = !searching && section === f.key;
            return (
              <button title={t('settings.row.modified')}
                key={f.key}
                className={`settings-nav-item${active ? ' active' : ''}`}
                style={{ '--depth': f.depth } as CSSProperties}
                aria-current={active}
                aria-expanded={parent ? isOpen : undefined}
                onClick={() => {
                  if (parent && (!expanded.has(f.key) || active)) toggle(f.key);
                  open(f.key);
                }}
              >
                <span
                  className={`settings-nav-twisty${parent ? '' : ' leaf'}${isOpen ? ' open' : ''}`}
                  onClick={(e) => {
                    if (!parent || searching) return;
                    e.stopPropagation();
                    toggle(f.key);
                  }}
                >
                  ▶
                </span>
                {sectionLabel(f.node)}
                {modifiedIn(f.node.path) && (
                  <span className="settings-nav-modified" title={t('settings.row.modified')} aria-label={t('settings.row.modified')} />
                )}
                {searching && <span className="settings-nav-count">{deepCount(f.key)}</span>}
              </button>
            );
          })}
        </nav>
        <div className="scroll" ref={body}>
          {searching
            ? flat.filter((f) => hits.has(f.key)).map((f) => {
                const hit = hits.get(f.key)!;
                return (
                  <div key={f.key} className="settings-group" data-section={f.key}>
                    <h3 className="settings-group-title">{f.trail.join(' › ')}</h3>
                    {hit.whole ? render(f.key) : <SettingRows ids={hit.ids} settings={draft} onChange={change} />}
                  </div>
                );
              })
            : selected && (
                <div key={`page-${selected.key}`} className="settings-page">
                  <h3 className="settings-group-title">{selected.trail.join(' › ')}</h3>
                  {hasOwn(selected.key) ? render(selected.key) : null}
                  {!hasOwn(selected.key) && selected.node.children.length > 0 && (
                    <div className="settings-links">
                      {selected.node.children.map((c) => (
                        <button key={sectionKey(c.path)} type="button" className="setting-link" onClick={() => { setExpanded((prev) => new Set([...prev, selected.key])); open(sectionKey(c.path)); }}>
                          {sectionLabel(c)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
          {onlyView && flat.length === 0 && <div className="settings-empty"><span className="muted">{t('settings.noViewSettings')}</span></div>}
          {searching && hits.size === 0 && (
            <div className="settings-empty">
              <span className="muted">{t('settings.search.none')}</span>
              <button title={t('settings.search.clear')} className="btn btn-sm" onClick={() => setQuery('')}>{t('settings.search.clear')}</button>
            </div>
          )}
        </div>
      </div>
      </SettingErrorsContext.Provider>
      </SettingLinksProvider>
    </div>
  );
}

/** Schema settings as one card of rows (search results, sections with no screen of their own). */
function SettingRows({ ids, settings, onChange }: { ids: string[]; settings: Settings; onChange: Change }) {
  return (
    <section className="section">
      <div className="card form">
        {ids.map((id) => <SettingRow key={id} def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />)}
      </div>
    </section>
  );
}

// What ArrowDown in the search box focuses first.
const CONTROLS = 'input, select, textarea, button';

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ');

function GeneralSection({ settings, onChange, onQuit }: Props) {
  return (
    <>
      <div className="card form">
        <label className="field">
          <span className="mono-label">{t('settings.language')}</span>
          <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        {settingsRegistry.settingsIn(['general']).map((def) => <SettingRow key={def.id} def={def} settings={settings} onChange={onChange} />)}
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
  );
}

/** Every command of the app, with the keys the user can change; a change applies at once. It has its own filter. */
function ShortcutsSection({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const keys = useKeybindings();
  if (!keys) return null;
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : tr(`nav.${scope}`, scope));
  return <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onChange({ keybindings })} scopeLabel={scopeLabel} />;
}


/**
 * Where closing the window doesn't stop the app: browser and app mode, and with the tray (the
 * setting, which applies after a restart; until then the tray menu or the close button quits).
 */
function GeneralCard({ onQuit }: { onQuit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const quit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.quit();
      onQuit();
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <div className="row">
            <button title={t('settings.quit')} className="btn btn-sm btn-danger" disabled={busy} onClick={quit}>
              {t('settings.quit')}
            </button>
          </div>
          <span className="muted">{t(isDesktop ? 'settings.quit.hintTray' : 'settings.quit.hint', { name: APP.name })}</span>
        </div>
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

function UpdatesCard({ folder, onFolder }: { folder: string; onFolder: (folder: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const state = useAsync(() => api.update(), [folder], 60_000);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const u = state.data;
  const status = !u
    ? null
    : u.code
      ? errorMessage({ kind: 'internal', code: u.code, message: u.message ?? '' })
      : u.status === 'not-configured'
      ? t('settings.update.notConfigured')
      : u.available
        ? t('settings.update.available', { version: u.version ?? '' })
        : u.status === 'offline'
          ? t('settings.update.offline')
          : u.status === 'error'
            ? (u.message ?? '')
            : t('settings.update.latest');

  return (
    <section className="section">
      <div className="card form">
        <div className="field">
          <label className="mono-label" htmlFor="update-folder">{t('settings.updateFolder')}</label>
          <div className="row">
            <input id="update-folder" value={folder} placeholder={t('settings.updateFolder.none')} readOnly />
            <button title={t('settings.updateFolder.browse')}
              className="btn btn-sm"
              disabled={busy}
              onClick={() => run(async () => {
                const path = await dialogs.pickFolder({ title: t('settings.updateFolder.pick'), purpose: 'updateFolder', start: folder || undefined });
                if (path === null) return;
                const next = (await api.pickUpdateFolder(path)).updateFolder;
                if (next !== folder) onFolder(next);
              })}
            >
              {t('settings.updateFolder.browse')}
            </button>
            {folder && (
              <button title={t('settings.updateFolder.clear')} className="btn btn-sm" disabled={busy} onClick={() => onFolder('')}>
                {t('settings.updateFolder.clear')}
              </button>
            )}
          </div>
          <span className="muted">{t('settings.updateFolder.hint')}</span>
        </div>
        {!u && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {u && (
          <div className="field">
            <span>
              {t('settings.update.current', { version: u.current })} {status}
            </span>
            {u.source && <span className="muted">{t('settings.update.source', { source: sourceLabel(u.source) })}</span>}
            {u.available && u.notes && <pre className="mono muted">{u.notes}</pre>}
            {u.available && !u.canApply && <span className="muted">{t('settings.update.fromSource')}</span>}
            <div className="row">
              <button title={t('settings.update.check')} className="btn btn-sm" disabled={busy || !u.source} onClick={() => run(() => api.checkUpdate().then(() => state.reload()))}>
                {t('settings.update.check')}
              </button>
              {u.available && u.canApply && (
                <button title={t('settings.update.apply')}
                  className="btn btn-sm btn-primary"
                  disabled={busy || restarting !== null}
                  onClick={() => run(async () => setRestarting((await api.applyUpdate()).version))}
                >
                  {t('settings.update.apply')}
                </button>
              )}
            </div>
          </div>
        )}
        {restarting && <span className="muted">{t('settings.update.restarting', { version: restarting })}</span>}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </section>
  );
}

const sourceLabel = (id: string): string => (id.startsWith('github:') ? `GitHub ${id.slice(7)}` : `${t('settings.update.folder')} ${id.slice(7)}`);
