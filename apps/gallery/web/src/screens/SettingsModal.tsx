import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AppearanceFields, DockField, IconsField, LayoutIconField, LayoutField, MainMenuField, SettingLinksProvider, type SettingLinks, SettingRow, useRevealSetting, useRovingList, SETTING_ROW_CONTROLS,ZoomField, type ApiError, detectLanguage, type FileAssociation, validFileAssociations, deepEqual, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, isModified, resetPatch, Modal, parseSettingsQuery, settingDescriptionText, toggleModifiedFilter, Spinner, useAsync, useKeybindings, tryT, type Language, type SettingDef, type SettingsSectionNode, sectionKey } from '@deckbuilderkit/ui';
import { APP } from '../../../app';
import { views } from '../views';
import { api, type BackupInfo, type EditorInfo, type ImportResult, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';
import { settingsRegistry } from '../settings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

type Change = (patch: Partial<Settings>) => void;

/** Translates `key` when it is a message, else falls back. */
const tr = (key: string | undefined, fallback?: string): string => (!key ? (fallback ?? '') : (tryT(key) ?? fallback ?? key));

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

/** Whether the screen can read and reset the setting (every non-custom one, and the custom ones that give a getter and setter). */
const handled = (def: SettingDef<Settings>): boolean => def.kind !== 'custom' || (!!def.get && !!def.set);

/** A setting's value in `s`. */
const valueOf = (def: SettingDef<Settings>, s: Settings): unknown => (def.get ? def.get(s) : undefined);

/** The patch that sets every one of `defs` back to its default, built on `s`. */
function defaultsPatch(defs: SettingDef<Settings>[], s: Settings): Partial<Settings> {
  let acc = s;
  let patch: Partial<Settings> = {};
  for (const def of defs) {
    const p = def.kind === 'custom' ? def.set?.(acc, def.default) : resetPatch(def, acc);
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
                <DockField value={draft} onChange={change} />
                <IconsField value={draft} onChange={change} />
                <LayoutIconField value={draft} onChange={change} />
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
      case 'keyboard': return <SettingRows ids={groupIds('keyboard')} settings={draft} onChange={change} />;
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
        // A view's page for its section, else the section's schema rows.
        const Card = views.settingsCards.cards[key];
        if (Card) return <Card settings={draft} onChange={change} row={(id) => <SettingFieldById key={id} id={id} settings={draft} onChange={change} />} rows={(ids) => <SettingRows ids={[...ids]} settings={draft} onChange={change} />} />;
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

/** A schema setting, with the hand-written field its view gives it (custom ones always have one). */
function SettingField({ def, settings, onChange }: { def: SettingDef<Settings>; settings: Settings; onChange: Change }) {
  const Field = views.settingsCards.fields[def.id];
  if (Field) return <Field def={def} settings={settings} onChange={onChange} />;
  return def.kind === 'custom' ? null : <SettingRow def={def} settings={settings} onChange={onChange} />;
}

/** The setting `id` as a row; nothing when it is not registered. */
function SettingFieldById({ id, settings, onChange }: { id: string; settings: Settings; onChange: Change }) {
  const def = settingsRegistry.setting(id);
  return def ? <SettingField def={def} settings={settings} onChange={onChange} /> : null;
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
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : views.has(scope) ? views.label(scope) : t('nav.home'));
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
