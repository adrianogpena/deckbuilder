import { type CSSProperties, Fragment, lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AppearanceFields, IconsField, LayoutField, MainMenuField, SettingItem, SettingLinksProvider, type SettingLinks, SettingRow, useRevealSetting, useRovingList, SETTING_ROW_CONTROLS,fileSettingsOf, ZoomField, type ApiError, detectLanguage, type FileAssociation, validFileAssociations, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, isModified, resetPatch, Modal, parseSettingsQuery, settingDescriptionText, toggleModifiedFilter, Spinner, useAsync, Icon, IconPicker, type IconName, useKeybindings, type Language, type SettingDef, type SettingsSectionNode, sectionKey } from '@deckbuilder/ui';
import type { ColorScheme } from '@deckbuilder/terminal/options';
import { isShellId, SHELL_ICONS, SHELL_IDS, SHELL_NAMES, type TerminalProfile, type TerminalProfileInfo } from '@deckbuilder/terminal/protocol';
import { APP } from '../../../app';
import { NAV } from '../nav';
import { api, type BackupInfo, type EditorInfo, type Project, type ImportResult, type Settings, type SqlFormatOptions, withWorkbenchDefaults } from '../api';
import { type MessageKey, t } from '../i18n';
import { en } from '../i18n/en';
import { settingDefault, settingsRegistry } from '../settings';
import { ProfileAppearanceFields, SchemesRow, ThemeRow } from './TerminalSchemes';

const CodeView = lazy(() => import('@deckbuilder/editor').then((m) => ({ default: m.CodeView })));

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
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

/** How the screen reads and writes the custom (hand-rendered) schema settings. */
const CUSTOM: Record<string, { get: (s: Settings) => unknown; set: (s: Settings, value: unknown) => Partial<Settings> }> = {
  'files.nestingPatterns': {
    get: (s) => fileSettingsOf(s.files).nestingPatterns,
    set: (s, v) => ({ files: { ...fileSettingsOf(s.files), nestingPatterns: v as Record<string, string> } }),
  },
  'files.exclude': {
    get: (s) => fileSettingsOf(s.files).exclude,
    set: (s, v) => ({ files: { ...fileSettingsOf(s.files), exclude: v as string[] } }),
  },
  'terminal.profiles': {
    get: (s) => s.terminal?.profiles ?? [],
    set: (s, v) => ({ terminal: { ...s.terminal, profiles: v as TerminalProfile[] } }),
  },
  'terminal.schemes': {
    get: (s) => s.terminal?.schemes ?? [],
    set: (s, v) => ({ terminal: { ...s.terminal, schemes: v as ColorScheme[] } }),
  },
  'workbench.explorerProjects': {
    get: (s) => withWorkbenchDefaults(s.workbench).explorerProjects,
    set: (s, v) => ({ workbench: { ...withWorkbenchDefaults(s.workbench), explorerProjects: v as string[] } }),
  },
};

/** Whether the screen can read and reset the setting (every non-custom one, and the custom ones in `CUSTOM`). */
const handled = (def: SettingDef<Settings>): boolean => def.kind !== 'custom' || Object.hasOwn(CUSTOM, def.id);

/** A setting's value in `s`. */
const valueOf = (def: SettingDef<Settings>, s: Settings): unknown => (def.kind === 'custom' ? CUSTOM[def.id]?.get(s) : def.get(s));

/** The patch that sets every one of `defs` back to its default, built on `s`. */
function defaultsPatch(defs: SettingDef<Settings>[], s: Settings): Partial<Settings> {
  let acc = s;
  let patch: Partial<Settings> = {};
  for (const def of defs) {
    const p = def.kind === 'custom' ? CUSTOM[def.id]?.set(acc, def.default) : resetPatch(def, acc);
    if (!p) continue;
    acc = { ...acc, ...p };
    patch = { ...patch, ...p };
  }
  return patch;
}

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
  const { text, modified, ids: only } = parseSettingsQuery(query);
  const words = norm(text).trim().split(' ').filter(Boolean);
  const filtered = modified || only.length > 0;
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

/** The section last shown; lives until the app restarts. */
let lastSection: string | undefined;

/**
 * Settings as VS Code opens them: a modal editor over the current screen, closed with Escape or a click outside.
 * The nav is the schema's section tree; a parent shows its own settings and its children's. Keyboard › Shortcuts
 * holds the keybindings editor, which has its own filter; `initialSection` opens a section directly.
 * Changes stay a draft until Apply or Ok; closing with changes asks whether to save them. The Shortcuts page and a backup import save at once.
 */
export function SettingsModal({ settings, onChange, onQuit, onClose, initialSection }: Props & { onClose: () => void; initialSection?: string }) {
  const flat = useMemo(() => flatten(settingsRegistry.sectionTree()), []);
  const [startSection] = useState(() => {
    const remembered = settings.rememberSettingsPage !== false && lastSection && flat.some((f) => f.key === lastSection) ? lastSection : undefined;
    return initialSection ?? remembered;
  });
  const [section, setSection] = useState(startSection ?? flat[0]?.key ?? 'general');
  useEffect(() => {
    lastSection = section;
  }, [section]);
  // The initial section's ancestors start expanded, so the nav shows it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const path = startSection?.split('.') ?? [];
    return new Set(path.slice(0, -1).map((_, i) => path.slice(0, i + 1).join('.')));
  });
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Partial<Settings>>({});
  const draft = useMemo<Settings>(() => ({ ...settings, ...pending }), [settings, pending]);
  const change: Change = (patch) => setPending((p) => ({ ...p, ...patch }));
  const dirty = Object.keys(pending).length > 0;
  const apply = () => {
    if (!dirty) return;
    onChange(pending);
    setPending({});
  };
  // Closing (Ok, X, Escape, backdrop) with unsaved changes asks first.
  const [asking, setAsking] = useState(false);
  const requestClose = () => (dirty ? setAsking(true) : onClose());
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';
  const hits = useMemo(() => searchSchema(flat, query, draft), [flat, query, draft]);
  const modifiedOnly = parseSettingsQuery(query).modified;
  const deepCount = (key: string) => [...hits].reduce((n, [k, h]) => (isUnder(k, key) ? n + h.ids.length : n), 0);
  const total = [...hits.values()].reduce((n, h) => n + h.ids.length, 0);

  const render = (key: string): ReactNode => {
    switch (key) {
      case 'general': return <GeneralSection settings={draft} onChange={change} onQuit={onQuit} />;
      case 'appearance':
        return (
          <>
            <section className="section">
              <div className="card form">
                <AppearanceFields value={draft} onChange={change} />
                <LayoutField value={draft} onChange={change} />
                <MainMenuField value={draft} onChange={change} />
                <IconsField value={draft} onChange={change} />
              </div>
            </section>
            <SettingRows ids={groupIds('appearance')} settings={draft} onChange={change} />
          </>
        );
      case 'window':
        return (
          <>
          <section className="section">
            <div className="card form">
              <ZoomField value={draft} onChange={change} />
            </div>
          </section>
          <SettingRows ids={groupIds('window')} settings={draft} onChange={change} />
          </>
        );
      case 'editor':
        return (
          <>
            <EditorCard settings={draft} onChange={change} />
            <SettingRows ids={groupIds('editor')} settings={draft} onChange={change} />
          </>
        );
      case 'editor.fileTypes': return <FileTypesCard value={draft.fileAssociations ?? []} onChange={(fileAssociations) => change({ fileAssociations })} />;
      case 'editor.externalEditors': return <EditorsCard />;
      case 'explorer': return <ExplorerCard settings={draft} onChange={change} />;
      case 'rest': return <SettingRows ids={groupIds('rest')} settings={draft} onChange={change} />;
      case 'workbench': return <WorkbenchCard settings={draft} onChange={change} />;
      case 'workbench.results': return <ResultsCard settings={draft} onChange={change} />;
      case 'workbench.sqlFormatter': return <FormatterCard settings={draft} onChange={change} />;
      case 'terminal': return null;
      case 'terminal.profiles':
        return (
          <>
            <TerminalCard shell={draft.terminal?.shell ?? 'auto'} onShell={(shell) => change({ terminal: { ...draft.terminal, shell } })} />
            <SettingRows ids={settingsRegistry.settingsIn(['terminal', 'profiles']).map((d) => d.id)} settings={draft} onChange={change} />
          </>
        );
      case 'keyboard': return <SettingRows ids={groupIds('keyboard')} settings={draft} onChange={change} />;
      case 'git': return <SettingRows ids={groupIds('git')} settings={draft} onChange={change} />;
      case 'keyboard.shortcuts': return <ShortcutsSection settings={settings} onChange={onChange} />;
      case 'system.updates': return <UpdatesCard folder={draft.updateFolder} onFolder={(updateFolder) => change({ updateFolder })} />;
      case 'system.backup': return (
        <BackupCard
          onSettings={(next) => {
            setPending({});
            onChange(next);
          }}
        />
      );
      default: {
        // Sections other packages or apps add: their schema rows.
        const path = key.split('.');
        const defs = settingsRegistry.settingsIn(path);
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
  // A node has unsaved changes when a setting in it (or under it) differs in the draft from the saved settings.
  const unsaved = (path: readonly string[]) =>
    dirty && settingsRegistry.settingsIn(path, true).some((s) => handled(s) && !deepEqual(valueOf(s, draft), valueOf(s, settings)));
  // Reset restores the defaults of the page shown: the selected section and its children.
  const pageDefs = selected && !searching ? settingsRegistry.settingsIn(selected.node.path, true).filter(handled) : [];
  const canReset = pageDefs.some((d) => !deepEqual(valueOf(d, draft), d.default));
  const footer = selected?.key === 'keyboard.shortcuts' && !searching ? undefined : (
    <>
      <button className="btn btn-sm" disabled={!canReset} onClick={() => change(defaultsPatch(pageDefs, draft))}>{t('settings.footer.reset')}</button>
      <button className="btn btn-sm" disabled={!dirty} onClick={apply}>{t('settings.footer.apply')}</button>
      <button
        className="btn btn-sm btn-primary"
        onClick={requestClose}
      >
        {t('settings.footer.ok')}
      </button>
    </>
  );
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
    <Modal title={t('settings.title')} onClose={requestClose} footer={footer} large>
      <SettingLinksProvider value={links}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
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
          {flat.filter(visible).map((f) => {
            const parent = f.node.children.length > 0;
            const isOpen = searching || expanded.has(f.key);
            const active = !searching && section === f.key;
            return (
              <button
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
                {unsaved(f.node.path) && (
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
                  {render(selected.key)}
                  {flat.filter((f) => f.key !== selected.key && isUnder(f.key, selected.key)).map((f) => (
                    <div key={f.key} className="settings-group" data-section={f.key}>
                      <h3 className="settings-subgroup-title">{f.trail.slice(selected.trail.length).join(' › ')}</h3>
                      {render(f.key)}
                    </div>
                  ))}
                </div>
              )}
          {searching && hits.size === 0 && (
            <div className="settings-empty">
              <span className="muted">{t('settings.search.none')}</span>
              <button className="btn btn-sm" onClick={() => setQuery('')}>{t('settings.search.clear')}</button>
            </div>
          )}
        </div>
      </div>
      </SettingLinksProvider>
      {asking && (
        <Modal
          title={t('settings.unsaved.title')}
          onClose={() => setAsking(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAsking(false)} autoFocus>{t('settings.unsaved.cancel')}</button>
              <button className="btn" onClick={onClose}>{t('settings.unsaved.discard')}</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  apply();
                  onClose();
                }}
              >
                {t('settings.unsaved.save')}
              </button>
            </>
          }
        >
          <p>{t('settings.unsaved.message')}</p>
        </Modal>
      )}
    </Modal>
  );
}

/** One schema setting rendered as a row. */
function Row({ id, settings, onChange }: { id: string; settings: Settings; onChange: Change }) {
  return <SettingRow def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />;
}

/** A schema setting, custom ones with the field their section uses. */
function SettingField({ def, settings, onChange }: { def: SettingDef<Settings>; settings: Settings; onChange: Change }) {
  if (def.id === 'terminal.defaultProfile') return <DefaultProfileRow def={def} settings={settings} onChange={onChange} />;
  if (def.id === 'terminal.theme') return <ThemeRow settings={settings} onChange={onChange} />;
  if (def.id === 'terminal.pasteLargeSize' && settings.terminal?.pasteWarning === 'never') {
    return <fieldset className="setting-disabled" disabled><SettingRow def={def} settings={settings} onChange={onChange} /></fieldset>;
  }
  if (def.kind !== 'custom') return <SettingRow def={def} settings={settings} onChange={onChange} />;
  const files = fileSettingsOf(settings.files);
  switch (def.id) {
    case 'files.nestingPatterns': return <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => onChange({ files: { ...files, nestingPatterns } })} />;
    case 'files.exclude': return <ExcludeField value={files.exclude} onChange={(exclude) => onChange({ files: { ...files, exclude } })} />;
    case 'workbench.explorerProjects': return <ProjectsRow settings={settings} onChange={onChange} />;
    case 'terminal.schemes': return <SchemesRow settings={settings} onChange={onChange} />;
    case 'terminal.profiles': return <ProfilesRow settings={settings} onChange={onChange} />;
    default: return null;
  }
}

/** Schema settings as one card of rows (search results, sections with no screen of their own). */
const groupIds = (group: string) => settingsRegistry.settingsIn([group]).filter((d) => d.id.startsWith(`${group}.`)).map((d) => d.id);

function SettingRows({ ids, settings, onChange }: { ids: string[]; settings: Settings; onChange: Change }) {
  return (
    <section className="section">
      <div className="card form">
        {ids.map((id) => <SettingField key={id} def={settingsRegistry.setting(id)!} settings={settings} onChange={onChange} />)}
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
        <Row id="general.autostart" settings={settings} onChange={onChange} />
        <Row id="general.closeToTray" settings={settings} onChange={onChange} />
        <Row id="general.rememberSettingsPage" settings={settings} onChange={onChange} />
        <Row id="general.confirmCloseDirty" settings={settings} onChange={onChange} />
        <Row id="general.toastDuration" settings={settings} onChange={onChange} />
        <Row id="general.startScreen" settings={settings} onChange={onChange} />
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
  );
}

/** Every command of the app, with the keys the user can change; a change applies at once. It has its own filter. */
function ShortcutsSection({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const keys = useKeybindings();
  if (!keys) return null;
  const screens = NAV.flatMap((s) => s.items);
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : t(screens.find((i) => i.id === scope)?.label ?? 'nav.home'));
  return <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onChange({ keybindings })} scopeLabel={scopeLabel} />;
}


/** Saving text files, like VS Code's `files.*` settings; the Explorer's file tabs read them. */
function EditorCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.saving')}</h4>
      <div className="card form">
        <Row id="files.autoSave" settings={settings} onChange={onChange} />
        <Row id="files.trimTrailingWhitespace" settings={settings} onChange={onChange} />
        <Row id="files.insertFinalNewline" settings={settings} onChange={onChange} />
      </div>
    </section>
  );
}

/** How the Explorer tree and its tabs behave (`files.*` settings, shared with the file tabs). */
function ExplorerCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const files = fileSettingsOf(settings.files);
  const set = (patch: Partial<typeof files>) => onChange({ files: { ...files, ...patch } });
  return (
    <>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.tabs')}</h4>
      <div className="card form">
        <Row id="files.previewTabs" settings={settings} onChange={onChange} />
        <Row id="files.autoReveal" settings={settings} onChange={onChange} />
        <Row id="files.breadcrumbs" settings={settings} onChange={onChange} />
        <Row id="files.restoreTabs" settings={settings} onChange={onChange} />
        <Row id="files.markdownToc" settings={settings} onChange={onChange} />
      </div>
    </section>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.view')}</h4>
      <div className="card form">
        <Row id="files.compactFolders" settings={settings} onChange={onChange} />
        <Row id="files.sortOrder" settings={settings} onChange={onChange} />
        <Row id="files.fileNesting" settings={settings} onChange={onChange} />
        <Row id="git.explorerDecorations" settings={settings} onChange={onChange} />
        <Row id="files.showHidden" settings={settings} onChange={onChange} />
        <Row id="files.confirmDelete" settings={settings} onChange={onChange} />
        <Row id="files.confirmDragDrop" settings={settings} onChange={onChange} />
        {files.fileNesting && <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => set({ nestingPatterns })} />}
        <ExcludeField value={files.exclude} onChange={(exclude) => set({ exclude })} />
      </div>
    </section>
    </>
  );
}

const FORMAT_GROUPS: ReadonlyArray<{ id: string; keys: ReadonlyArray<keyof SqlFormatOptions> }> = [
  { id: 'case', keys: ['keywordCase', 'functionCase'] },
  { id: 'select', keys: ['columnsPerLine', 'newlineAfterSelect', 'singleColumnInline'] },
  { id: 'conditions', keys: ['conditionPerLine', 'andOrPosition', 'joinConditionOnNewLine', 'spaceAroundOperators'] },
  { id: 'subqueries', keys: ['caseLayout', 'caseMaxWidth', 'subqueryNewlineAfterParen', 'subqueryCloseParenOnOwnLine'] },
  { id: 'statements', keys: ['indent', 'groupOrderListPerLine', 'fromTablesPerLine', 'setItemsPerLine', 'blankLineBetweenStatements'] },
];

/** Exercises every format option: comments, CASE, JOIN, several FROM tables, IN list, subqueries, GROUP/ORDER lists, UPDATE SET. */
const FORMAT_SAMPLE =
  "-- active staff per department\n" +
  "select e.id, e.name, lower(d.title) as dept, count(*) as n, case when e.salary>5000 then 'high' when e.salary>2000 then 'mid' else 'low' end as band /* salary band */ " +
  "from employees e join departments d on d.id=e.dept_id and d.active=1, locations l " +
  "where e.active=1 and l.id=d.location_id and (e.status in ('A', 'B', 'C') or e.manager_id is null) and d.region in (select region from regions where code='EU') " +
  "group by e.id, e.name, d.title, e.salary order by dept, e.name;\n" +
  "update employees set salary=salary*1.1, updated=sysdate, note='raise' where dept_id in (select id from departments where region='EU');";

/** Allowed projects as a short list with remove buttons, and a searchable "add" list for the rest. */
function ProjectsField({ projects, error, onRetry, value, onChange }: {
  projects: Project[] | undefined;
  error: ApiError | undefined;
  onRetry: () => void;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const allowed = projects?.filter((p) => value.includes(p.id)) ?? [];
  const q = norm(query);
  const candidates = projects?.filter((p) => !value.includes(p.id) && (!q || norm(p.name).includes(q) || norm(p.path).includes(q))) ?? [];
  const add = (id: string) => {
    onChange([...value, id]);
    setAdding(false);
    setQuery('');
  };
  return (
    <div className="field">
      <span className="mono-label">{t('settings.workbench.projects')}</span>
      {error && <ErrorBanner error={error} onRetry={onRetry} compact />}
      {!projects && !error && <Spinner small />}
      {projects?.length === 0 && <span className="muted">{t('settings.workbench.projects.none')}</span>}
      {projects && allowed.length === 0 && projects.length > 0 && <span className="muted">{t('settings.workbench.projects.empty')}</span>}
      {allowed.map((p) => (
        <div key={p.id} className="check-row">
          <span>{p.name}</span>
          <button className="btn btn-sm" onClick={() => onChange(value.filter((id) => id !== p.id))}>{t('settings.workbench.projects.remove')}</button>
        </div>
      ))}
      {projects && projects.length > allowed.length && (adding ? (
        <>
          <input autoFocus value={query} placeholder={t('settings.workbench.projects.search')} spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <div className="project-add-list">
            {candidates.length === 0 && <span className="muted">{t('settings.workbench.projects.noMatch')}</span>}
            {candidates.map((p) => (
              <button key={p.id} className="menu-item" onClick={() => add(p.id)}>
                <span className="menu-label">{p.name}</span>
                <span className="muted">{p.path}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>{t('settings.workbench.projects.add')}</button>
      ))}
      <span className="muted">{t('settings.workbench.projects.hint')}</span>
    </div>
  );
}

/** The allowed projects field with the project list loaded. */
function ProjectsRow({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const projects = useAsync(() => api.projects(), []);
  const wb = withWorkbenchDefaults(settings.workbench);
  const id = 'workbench.explorerProjects';
  const fallback = settingDefault<string[]>(id);
  const save = (explorerProjects: string[]) => onChange({ workbench: { ...wb, explorerProjects } });
  return (
    <SettingItem id={id} modified={!deepEqual(wb.explorerProjects, fallback)}>
      <ProjectsField
        projects={projects.data}
        error={projects.error}
        onRetry={projects.reload}
        value={wb.explorerProjects}
        onChange={save}
      />
    </SettingItem>
  );
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

/** Which projects run SQL from the Explorer, and how many rows a run fetches. */
function WorkbenchCard({ settings, onChange }: { settings: Settings; onChange: Change }) {
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.workbench.sql')}</h4>
      <div className="card form">
        <ProjectsRow settings={settings} onChange={onChange} />
        <Row id="workbench.maxRows" settings={settings} onChange={onChange} />
        <Row id="workbench.confirmDestructive" settings={settings} onChange={onChange} />
        <Row id="workbench.queryTimeout" settings={settings} onChange={onChange} />
        <Row id="workbench.historySize" settings={settings} onChange={onChange} />
      </div>
    </section>
  );
}

/** How result cells read and copy. */
function ResultsCard({ settings, onChange }: { settings: Settings; onChange: Change }) {
  return (
    <section className="section">
      <div className="card form">
        <Row id="workbench.results.nullText" settings={settings} onChange={onChange} />
        <Row id="workbench.results.dateFormat" settings={settings} onChange={onChange} />
        <Row id="workbench.results.hideMidnight" settings={settings} onChange={onChange} />
        <Row id="workbench.results.timestampFormat" settings={settings} onChange={onChange} />
        <Row id="workbench.results.thousandsSeparator" settings={settings} onChange={onChange} />
        <Row id="workbench.copyFormat" settings={settings} onChange={onChange} />
      </div>
    </section>
  );
}

/** The SQL formatter options with a live preview. */
function FormatterCard({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const wb = withWorkbenchDefaults(settings.workbench);
  const [preview, setPreview] = useState(FORMAT_SAMPLE);
  useEffect(() => {
    let live = true;
    import('@deckbuilder/editor').then(({ formatSql }) => {
      let text = FORMAT_SAMPLE;
      try {
        text = formatSql(FORMAT_SAMPLE, wb.format);
      } catch { /* keep the raw sample */ }
      if (live) setPreview(text);
    });
    return () => { live = false; };
  }, [wb.format]);
  return (
    <div className="settings-format">
      <aside className="settings-format-preview">
        <h4 className="mono-label">{t('settings.workbench.preview')}</h4>
        <span className="muted">{t('settings.workbench.preview.hint')}</span>
        <Suspense fallback={null}><Suspense fallback={null}><CodeView value={preview} lang="sql" /></Suspense></Suspense>
      </aside>
      <div className="settings-format-options">
        {FORMAT_GROUPS.map((group) => (
          <section key={group.id} className="section">
            <h4 className="mono-label">{t(`settings.workbench.group.${group.id}` as MessageKey)}</h4>
            <div className="card form">
              {group.keys.map((key) => <Row key={key} id={`workbench.format.${key}`} settings={settings} onChange={onChange} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * For a field that edits `value` as local text: runs `resync` when `value` changes from outside (a page Reset) while
 * the returned textarea ref is not focused, so the text shows the new value.
 */
function useResync(value: unknown, resync: () => void) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = JSON.stringify(value);
  const run = useRef(resync);
  run.current = resync;
  useEffect(() => {
    if (document.activeElement !== ref.current) run.current();
  }, [key]);
  return ref;
}

function NestingField({ value, onChange }: { value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const toText = (v: Record<string, string>) => Object.entries(v).map(([k, c]) => `${k}: ${c}`).join(String.fromCharCode(10));
  const [text, setText] = useState(toText(value));
  const area = useResync(value, () => setText(toText(value)));
  const id = 'files.nestingPatterns';
  const fallback = settingDefault<Record<string, string>>(id);
  return (
    <SettingItem id={id} modified={!deepEqual(value, fallback)}>
    <div className="field">
      <span className="mono-label">{t('settings.explorer.nesting.patterns')}</span>
      <textarea
        ref={area}
        value={text}
        rows={6}
        spellCheck={false}
        aria-label={t('settings.explorer.nesting.patterns')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next: Record<string, string> = {};
          for (const line of text.split(String.fromCharCode(10))) {
            const at = line.indexOf(':');
            const parent = line.slice(0, at).trim();
            const children = line.slice(at + 1).trim();
            if (at > 0 && parent && children) next[parent] = children;
          }
          onChange(next);
        }}
      />
      <span className="muted">{t('settings.explorer.nesting.patterns.hint')}</span>
    </div>
    </SettingItem>
  );
}

function ExcludeField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  const area = useResync(value, () => setText(value.join('\n')));
  const id = 'files.exclude';
  const fallback = settingDefault<string[]>(id);
  return (
    <SettingItem id={id} modified={!deepEqual(value, fallback)}>
    <div className="field">
      <span className="mono-label">{t('settings.explorer.exclude')}</span>
      <textarea
        ref={area}
        value={text}
        rows={4}
        spellCheck={false}
        aria-label={t('settings.explorer.exclude')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split('\n').map((l) => l.trim()).filter(Boolean))}
      />
      <span className="muted">{t('settings.explorer.exclude.hint')}</span>
    </div>
    </SettingItem>
  );
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
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={quit}>
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

const ASSOCIATION_TARGETS = ['log', 'txt', 'json', 'md', 'sql', 'xml', 'yaml', 'properties', 'csv', 'html', 'js', 'java', 'sh', 'env', 'zip'] as const;

/** Name patterns opened as another file type; a row applies once its pattern is valid. */
function FileTypesCard({ value, onChange }: { value: FileAssociation[]; onChange: (next: FileAssociation[]) => void }) {
  const [rows, setRows] = useState<FileAssociation[]>(value);
  const update = (next: FileAssociation[]) => {
    setRows(next);
    const valid = validFileAssociations(next.filter((r) => r.pattern.trim()));
    if (valid) onChange(valid);
  };
  const targetLabel = (as: string) => (ASSOCIATION_TARGETS.includes(as as never) ? t(`settings.files.as.${as}` as MessageKey) : `.${as}`);
  return (
    <section className="section">
      <div className="card form">
        <span className="muted">{t('settings.files.hint')}</span>
        {rows.length === 0 && <span className="muted">{t('settings.files.empty')}</span>}
        {rows.map((row, i) => (
          <div key={i} className="row">
            <input
              value={row.pattern}
              placeholder="*.log.*"
              aria-label={t('settings.files.pattern')}
              spellCheck={false}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, pattern: e.target.value } : r)))}
            />
            <select value={row.as} aria-label={t('settings.files.as')} onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, as: e.target.value } : r)))}>
              {!ASSOCIATION_TARGETS.includes(row.as as never) && <option value={row.as}>{targetLabel(row.as)}</option>}
              {ASSOCIATION_TARGETS.map((as) => <option key={as} value={as}>{targetLabel(as)}</option>)}
            </select>
            <button className="btn btn-sm" onClick={() => update(rows.filter((_, j) => j !== i))}>{t('settings.files.remove')}</button>
          </div>
        ))}
        <div className="row">
          <button className="btn btn-sm" onClick={() => setRows([...rows, { pattern: '', as: 'log' }])}>{t('settings.files.add')}</button>
        </div>
      </div>
    </section>
  );
}

function TerminalCard({ shell, onShell }: { shell: string; onShell: (shell: string) => void }) {
  const shells = useAsync(() => api.terminalShells(), []);
  return (
    <section className="section">
      <div className="card form">
        {shells.error && <ErrorBanner error={shells.error} onRetry={shells.reload} compact />}
        <label className="field">
          <span className="mono-label">{t('settings.terminal.shell')}</span>
          <select value={shell} disabled={!shells.data} onChange={(e) => onShell(e.target.value)}>
            <option value="auto">{t('settings.terminal.auto')}</option>
            {shells.data?.filter((id) => id !== 'auto').map((id) => <option key={id} value={id}>{SHELL_NAMES[id as keyof typeof SHELL_NAMES] ?? id}</option>)}
          </select>
          <span className="muted">{t('settings.terminal.hint')}</span>
        </label>
      </div>
    </section>
  );
}

/** The default profile: a select of the available, visible profiles; empty follows the shell setting. */
function DefaultProfileRow({ def, settings, onChange }: { def: SettingDef<Settings>; settings: Settings; onChange: Change }) {
  const infos = useAsync(() => api.terminalProfiles(), []);
  const value = String(valueOf(def, settings) ?? '');
  const options = mergeProfiles(infos.data ?? [], settings.terminal?.profiles ?? []).filter((p) => p.available && !p.hidden);
  const known = options.some((p) => p.id === value);
  return (
    <SettingItem id={def.id} modified={isModified(def, settings)}>
      <label className="field">
        <span className="mono-label">{tr(def.label)}</span>
        <select value={value} onChange={(e) => onChange({ terminal: { ...settings.terminal, defaultProfile: e.target.value } })}>
          <option value="">{t('settings.terminal.defaultProfile.none')}</option>
          {!known && value && <option value={value}>{value}</option>}
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="muted">{tr(def.description)}</span>
      </label>
    </SettingItem>
  );
}

const isBuiltinId = (id: string) => isShellId(id) && id !== 'auto';
const DEFAULT_ICON = 'terminal';
const iconOf = (p: TerminalProfile): IconName =>
  (p.icon || (isBuiltinId(p.shell) ? SHELL_ICONS[p.shell as keyof typeof SHELL_ICONS] : '') || DEFAULT_ICON) as IconName;
const defaultIconOf = (p: TerminalProfile): IconName => (isBuiltinId(p.id) ? SHELL_ICONS[p.id as keyof typeof SHELL_ICONS] : DEFAULT_ICON) as IconName;
const ABSOLUTE = /^([a-zA-Z]:[\\/]|\/|\\\\)/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PROFILES = 50;

type ProfileRowData = TerminalProfile & { available: boolean };

/** The server's profiles with the draft's overrides and custom entries applied: built-ins first, then custom ones. */
function mergeProfiles(infos: TerminalProfileInfo[], saved: TerminalProfile[]): ProfileRowData[] {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const builtin = infos
    .filter((p) => isBuiltinId(p.id))
    .map((p) => {
      const o = byId.get(p.id);
      return { ...p, ...(o ?? {}), id: p.id, shell: p.shell, available: p.available, icon: o?.icon ?? p.icon };
    });
  const custom = saved.filter((p) => !isBuiltinId(p.id)).map((p) => ({ ...p, available: true }));
  return [...builtin, ...custom];
}

/** An entry without the keys that hold their defaults, so a reset built-in leaves no override behind. */
function compact(p: TerminalProfile): TerminalProfile {
  const out: TerminalProfile = { ...p };
  for (const key of ['command', 'args', 'env', 'cwd', 'icon', 'hidden', 'shellIntegration', 'appearance'] as const) {
    const v = out[key];
    const empty = v === undefined || v === '' || v === false && key === 'hidden' || (Array.isArray(v) && v.length === 0) || ((key === 'env' || key === 'appearance') && !!v && Object.keys(v).length === 0);
    if (empty) delete out[key];
  }
  return out;
}

const linesOf = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const envOf = (text: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of linesOf(text)) {
    const at = line.indexOf('=');
    const key = at < 0 ? '' : line.slice(0, at).trim();
    if (ENV_KEY.test(key)) env[key] = line.slice(at + 1);
  }
  return env;
};

/** A multi-line field kept as free text while typing; `parse` turns it into the stored value. */
function TextLinesField<V>({ label, hint, value, toText, parse, onChange }: {
  label: string;
  hint: string;
  value: V;
  toText: (v: V) => string;
  parse: (text: string) => V;
  onChange: (v: V) => void;
}) {
  const [text, setText] = useState(() => toText(value));
  // An outside change (reset) replaces the text; typing keeps it.
  useEffect(() => {
    if (!deepEqual(parse(text), value)) setText(toText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <textarea rows={3} value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />
      <span className="muted">{hint}</span>
    </label>
  );
}

function ProfilesRow({ settings, onChange }: { settings: Settings; onChange: Change }) {
  const fallback = settingDefault<TerminalProfile[]>('terminal.profiles');
  const saved = settings.terminal?.profiles ?? [];
  return (
    <SettingItem id="terminal.profiles" modified={!deepEqual(saved, fallback)}>
      <ProfilesField value={saved} terminal={settings.terminal} onChange={(profiles) => onChange({ terminal: { ...settings.terminal, profiles } })} />
    </SettingItem>
  );
}

function ProfilesField({ value, terminal, onChange }: { value: TerminalProfile[]; terminal: Settings['terminal']; onChange: (profiles: TerminalProfile[]) => void }) {
  const infos = useAsync(() => api.terminalProfiles(), []);
  const [editing, setEditing] = useState<string>();
  const [picking, setPicking] = useState<string>();
  const rows = mergeProfiles(infos.data ?? [], value);
  const listed = rows.filter((p) => !isBuiltinId(p.id) || p.available);

  // Writes a row's fields; a built-in keeps only its overrides and drops out when nothing is left.
  const update = (id: string, patch: Partial<TerminalProfile>) => {
    const current = value.find((p) => p.id === id);
    if (!isBuiltinId(id)) {
      onChange(value.map((p) => (p.id === id ? compact({ ...p, ...patch }) : p)));
      return;
    }
    const name = SHELL_NAMES[id as keyof typeof SHELL_NAMES];
    const next = compact({ ...(current ?? { id, name, shell: id as TerminalProfile['shell'] }), ...patch });
    const bare = next.name === name && Object.keys(next).every((k) => ['id', 'name', 'shell'].includes(k));
    const others = value.filter((p) => p.id !== id);
    onChange(bare ? others : current ? value.map((p) => (p.id === id ? next : p)) : [...others, next]);
  };
  const add = () => {
    let id = `custom-${Date.now().toString(36)}`;
    while (value.some((p) => p.id === id)) id += 'x';
    const shell = ((infos.data ?? []).find((p) => isBuiltinId(p.id) && p.available)?.id ?? 'powershell') as TerminalProfile['shell'];
    onChange([...value, { id, name: t('settings.terminal.profiles.newName'), shell }]);
    setEditing(id);
  };
  const remove = (id: string) => {
    if (editing === id) setEditing(undefined);
    onChange(value.filter((p) => p.id !== id));
  };
  const pickingRow = rows.find((p) => p.id === picking);

  return (
    <div className="field profiles">
      <span className="mono-label">{t('settings.terminal.profiles')}</span>
      <span className="muted">{t('settings.terminal.profiles.hint')}</span>
      {infos.error && <ErrorBanner error={infos.error} onRetry={infos.reload} compact />}
      {!infos.data && !infos.error && <Spinner small />}
      <div className="profile-list">
        {listed.map((p) => {
          const builtin = isBuiltinId(p.id);
          const open = editing === p.id;
          return (
            <div key={p.id} className={`profile-row${p.hidden ? ' is-hidden' : ''}${open ? ' is-open' : ''}`}>
              <button className="btn btn-sm btn-icon btn-ghost" title={t('settings.terminal.profiles.changeIcon')} aria-label={t('settings.terminal.profiles.changeIcon')} onClick={() => setPicking(p.id)}>
                <Icon name={iconOf(p)} size={16} />
              </button>
              <span className="profile-name">{p.name}{p.hidden && <span className="muted"> ({t('settings.terminal.profiles.hidden')})</span>}</span>
              <span className="muted profile-shell">
                {p.shell === 'custom' ? t('settings.terminal.profiles.shell.custom') : SHELL_NAMES[p.shell as keyof typeof SHELL_NAMES] ?? p.shell}
                {' · '}{builtin ? t('settings.terminal.profiles.builtin') : t('settings.terminal.profiles.custom')}
              </span>
              <span className="profile-actions">
                {builtin && <button className="btn btn-sm" onClick={() => update(p.id, { hidden: !p.hidden })}>{t(p.hidden ? 'settings.terminal.profiles.show' : 'settings.terminal.profiles.hide')}</button>}
                <button className="btn btn-sm" aria-expanded={open} onClick={() => setEditing(open ? undefined : p.id)}>{t(open ? 'settings.terminal.profiles.done' : 'settings.terminal.profiles.edit')}</button>
                {!builtin && <button className="btn btn-sm" onClick={() => remove(p.id)}>{t('settings.terminal.profiles.delete')}</button>}
              </span>
              {open && (
                <ProfileEditor
                  profile={p}
                  terminal={terminal}
                  builtin={builtin}
                  onChange={(patch) => update(p.id, patch)}
                  onPickIcon={() => setPicking(p.id)}
                  onReset={builtin && value.some((v) => v.id === p.id) ? () => onChange(value.filter((v) => v.id !== p.id)) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={value.length >= MAX_PROFILES} onClick={add}>{t('settings.terminal.profiles.add')}</button>
      </div>
      {pickingRow && (
        <IconPicker
          value={iconOf(pickingRow)}
          onPick={(icon) => {
            update(pickingRow.id, { icon });
            setPicking(undefined);
          }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}

function ProfileEditor({ profile: p, terminal, builtin, onChange, onPickIcon, onReset }: {
  profile: ProfileRowData;
  terminal: Settings['terminal'];
  builtin: boolean;
  onChange: (patch: Partial<TerminalProfile>) => void;
  onPickIcon: () => void;
  onReset?: () => void;
}) {
  const shells = SHELL_IDS.filter((id) => id !== 'auto');
  const defaultName = builtin ? SHELL_NAMES[p.id as keyof typeof SHELL_NAMES] : undefined;
  const invalid = !p.name.trim() || (p.shell === 'custom' && !(p.command && ABSOLUTE.test(p.command)));
  const field = (id: string, modified: boolean, child: ReactNode) => <SettingItem id={`terminal.profiles.${p.id}.${id}`} modified={modified}>{child}</SettingItem>;
  return (
    <div className="profile-editor">
      {invalid && <span className="req-hint tone-warn">{t('settings.terminal.profiles.invalid')}</span>}
      {field('name', builtin && p.name !== defaultName, (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.name')}</span>
          <input value={p.name} spellCheck={false} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
      ))}
      {!builtin && (
        <div className="field">
          <span className="mono-label">{t('settings.terminal.profiles.shell')}</span>
          <select
            value={p.shell}
            aria-label={t('settings.terminal.profiles.shell')}
            onChange={(e) => onChange({ shell: e.target.value as TerminalProfile['shell'], ...(e.target.value === 'custom' ? {} : { command: undefined }) })}
          >
            {shells.map((id) => <option key={id} value={id}>{SHELL_NAMES[id as keyof typeof SHELL_NAMES]}</option>)}
            <option value="custom">{t('settings.terminal.profiles.shell.custom')}</option>
          </select>
        </div>
      )}
      {!builtin && p.shell === 'custom' && (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.command')}</span>
          <input value={p.command ?? ''} spellCheck={false} onChange={(e) => onChange({ command: e.target.value })} />
          <span className="muted">{t('settings.terminal.profiles.command.hint')}</span>
        </label>
      )}
      {field('args', (p.args?.length ?? 0) > 0, (
        <TextLinesField label={t('settings.terminal.profiles.args')} hint={t('settings.terminal.profiles.args.hint')} value={p.args ?? []} toText={(v) => v.join('\n')} parse={linesOf} onChange={(args) => onChange({ args })} />
      ))}
      {field('env', Object.keys(p.env ?? {}).length > 0, (
        <TextLinesField
          label={t('settings.terminal.profiles.env')}
          hint={t('settings.terminal.profiles.env.hint')}
          value={p.env ?? {}}
          toText={(v) => Object.entries(v).map(([k, x]) => `${k}=${x}`).join('\n')}
          parse={envOf}
          onChange={(env) => onChange({ env })}
        />
      ))}
      {field('cwd', !!p.cwd, (
        <label className="field">
          <span className="mono-label">{t('settings.terminal.profiles.cwd')}</span>
          <input value={p.cwd ?? ''} spellCheck={false} onChange={(e) => onChange({ cwd: e.target.value })} />
          <span className="muted">{t('settings.terminal.profiles.cwd.hint')}</span>
        </label>
      ))}
      {field('icon', !!p.icon && p.icon !== defaultIconOf(p), (
        <div className="field">
          <span className="mono-label">{t('settings.terminal.profiles.changeIcon')}</span>
          <div className="row">
            <button className="btn btn-sm" onClick={onPickIcon}><Icon name={iconOf(p)} size={16} /> {iconOf(p)}</button>
            <button className="btn btn-sm" disabled={!p.icon} onClick={() => onChange({ icon: undefined })}>{t('settings.terminal.profiles.defaultIcon')}</button>
          </div>
        </div>
      ))}
      {field('shellIntegration', p.shellIntegration === false, (
        <label className="field setting-check">
          <span className="mono-label">{t('settings.terminal.profiles.shellIntegration')}</span>
          <input
            type="checkbox"
            checked={p.shellIntegration !== false}
            aria-label={t('settings.terminal.profiles.shellIntegration')}
            onChange={(e) => onChange({ shellIntegration: e.target.checked ? undefined : false })}
          />
        </label>
      ))}
      <ProfileAppearanceFields value={p.appearance} terminal={terminal} onChange={(appearance) => onChange({ appearance })} />
      {onReset && <div className="row"><button className="btn btn-sm" onClick={onReset}>{t('settings.terminal.profiles.reset')}</button></div>}
    </div>
  );
}

function EditorsCard() {
  const state = useAsync(() => api.editors(), []);
  const [list, setList] = useState<EditorInfo[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (job: () => Promise<EditorInfo[]>) => {
    setBusy(true);
    setError(null);
    try {
      setList(await job());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const editors = list ?? state.data;
  return (
    <section className="section">
      <div className="card form">
        {!editors && !state.error && <Spinner small />}
        {state.error && <ErrorBanner error={state.error} onRetry={state.reload} compact />}
        {editors && (
          <div className="editors">
            {editors.map((editor) => (
              <Fragment key={editor.id}>
                <span className="mono-label">{editor.name}</span>
                <span className="mono editor-path">{editor.path ?? t('settings.editors.notFound')}</span>
                <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.pickEditor(editor.id))}>
                  {t('settings.editors.choose')}
                </button>
                {editor.custom ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.resetEditor(editor.id))}>
                    {t('settings.editors.reset')}
                  </button>
                ) : (
                  <span />
                )}
              </Fragment>
            ))}
          </div>
        )}
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
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => run(async () => {
                const next = (await api.pickUpdateFolder(t('settings.updateFolder.pick'))).updateFolder;
                if (next !== folder) onFolder(next);
              })}
            >
              {t('settings.updateFolder.browse')}
            </button>
            {folder && (
              <button className="btn btn-sm" disabled={busy} onClick={() => onFolder('')}>
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
              <button className="btn btn-sm" disabled={busy || !u.source} onClick={() => run(() => api.checkUpdate().then(() => state.reload()))}>
                {t('settings.update.check')}
              </button>
              {u.available && u.canApply && (
                <button
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

const STORE_LABELS: Record<string, MessageKey> = {
  projects: 'settings.backup.store.projects',
  dbConnections: 'settings.backup.store.dbConnections',
  requests: 'settings.backup.store.requests',
};
const storeLabel = (name: string) => (Object.hasOwn(STORE_LABELS, name) ? t(STORE_LABELS[name]!) : name);

const toggled = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

type Inspected = Extract<BackupInfo, { token: string }>;
type Imported = { settings: boolean; stores: Record<string, ImportResult> };

function BackupCard({ onSettings }: { onSettings: (settings: Settings) => void }) {
  const parts = useAsync(() => api.backupParts(), []);
  const [settings, setSettings] = useState(true);
  const [stores, setStores] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);

  const chosen = stores ?? parts.data?.stores ?? [];
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="card form">
        {!parts.data && !parts.error && <Spinner small />}
        {parts.error && <ErrorBanner error={parts.error} onRetry={parts.reload} compact />}
        {parts.data && (
          <div className="field">
            <span className="mono-label">{t('settings.backup.parts')}</span>
            <div className="chips">
              <button className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                {t('settings.backup.settings')}
              </button>
              {parts.data.stores.map((name) => (
                <button key={name} className={`chip${chosen.includes(name) ? ' chip-on' : ''}`} onClick={() => setStores(toggled(chosen, name))}>
                  {storeLabel(name)}
                </button>
              ))}
            </div>
            <span className="muted">{t('settings.backup.hint')}</span>
            <div className="row">
              <button
                className="btn btn-sm"
                disabled={busy || (!settings && chosen.length === 0)}
                onClick={() => run(async () => setSaved((await api.exportBackup(settings, chosen)).path))}
              >
                {t('settings.backup.export')}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => run(async () => {
                  const info = await api.inspectBackup();
                  if (info.token !== null) setInspected(info);
                })}
              >
                {t('settings.backup.import')}
              </button>
            </div>
            {saved && <span className="muted">{t('settings.backup.saved', { path: saved })}</span>}
          </div>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
      {inspected && <ImportDialog info={inspected} onSettings={onSettings} onClose={() => setInspected(null)} />}
    </section>
  );
}

function ImportDialog({ info, onSettings, onClose }: { info: Inspected; onSettings: (settings: Settings) => void; onClose: () => void }) {
  const [settings, setSettings] = useState(info.settings);
  const [stores, setStores] = useState(info.stores.filter((s) => s.known).map((s) => s.name));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Imported | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api.importBackup(info.token, settings, stores, mode);
      setResult(done);
      if (done.settings) onSettings(await api.settings());
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <button className="btn btn-primary" onClick={onClose}>{t('settings.backup.close')}</button>
  ) : (
    <>
      <button className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
      <button className="btn btn-primary" disabled={busy || (!settings && stores.length === 0)} onClick={start}>
        {t('settings.backup.importNow')}
      </button>
    </>
  );
  const date = info.exportedAt ? new Date(info.exportedAt).toLocaleString() : '?';

  return (
    <Modal title={t('settings.backup.importTitle')} onClose={onClose} footer={footer}>
      <div className="form">
        <span className="muted">{t('settings.backup.from', { date, version: info.appVersion || '?' })}</span>
        {result ? (
          <ImportSummary result={result} />
        ) : (
          <>
            <div className="field">
              <span className="mono-label">{t('settings.backup.parts')}</span>
              <div className="chips">
                {info.settings && (
                  <button className={`chip${settings ? ' chip-on' : ''}`} onClick={() => setSettings(!settings)}>
                    {t('settings.backup.settings')}
                  </button>
                )}
                {info.stores.map((s) => (
                  <button
                    key={s.name}
                    className={`chip${stores.includes(s.name) ? ' chip-on' : ''}`}
                    disabled={!s.known}
                    title={s.known ? undefined : t('settings.backup.unknown')}
                    onClick={() => setStores(toggled(stores, s.name))}
                  >
                    {storeLabel(s.name)} ({s.count})
                  </button>
                ))}
              </div>
              {info.stores.some((s) => !s.known) && <span className="muted">{t('settings.backup.unknownHint')}</span>}
            </div>
            <div className="field">
              <span className="mono-label">{t('settings.backup.mode')}</span>
              <div className="chips">
                {(['merge', 'replace'] as const).map((m) => (
                  <button key={m} className={`chip${mode === m ? ' chip-on' : ''}`} onClick={() => setMode(m)}>
                    {t(m === 'merge' ? 'settings.backup.merge' : 'settings.backup.replace')}
                  </button>
                ))}
              </div>
              <span className="muted">{t(mode === 'merge' ? 'settings.backup.merge.hint' : 'settings.backup.replace.hint')}</span>
            </div>
          </>
        )}
        {error && <ErrorBanner error={error} compact />}
      </div>
    </Modal>
  );
}

function ImportSummary({ result }: { result: Imported }) {
  return (
    <>
      {result.settings && <span>{t('settings.backup.settingsDone')}</span>}
      {Object.entries(result.stores).map(([name, r]) => (
        <div key={name} className="field">
          <span className="mono-label">{storeLabel(name)}</span>
          <span>{t('settings.backup.counts', { added: r.added, updated: r.updated, removed: r.removed })}</span>
          {r.skipped.map((s, i) => (
            <span key={i} className="tone-err small">
              {t('settings.backup.skipped', { id: s.id ?? '?', reason: errorMessage({ kind: 'invalid', code: s.code, message: s.message }) })}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
