import { Fragment, useState } from 'react';
import { AppearanceFields, AUTO_SAVE, type AutoSave, SORT_ORDERS, fileSettingsOf, ZoomField, type ApiError, detectLanguage, type FileAssociation, validFileAssociations, ErrorBanner, errorMessage, errorOf, GLOBAL, isDesktop, KeybindingsEditor, LANGUAGES, Modal, PageHead, Spinner, useAsync, useKeybindings, type Language } from '@deckbuilder/ui';
import { APP } from '../../../app';
import { api, type BackupInfo, type EditorInfo, type ImportResult, type Settings } from '../api';
import { type MessageKey, t } from '../i18n';
import { NAV } from '../nav';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Called once the server accepted the quit. */
  onQuit: () => void;
}

const SECTIONS = [
  { id: 'general', label: 'settings.general' },
  { id: 'layout', label: 'settings.layout' },
  { id: 'keys', label: 'settings.keys' },
  { id: 'explorer', label: 'settings.explorer' },
  { id: 'files', label: 'settings.files' },
  { id: 'editors', label: 'settings.editors' },
  { id: 'terminal', label: 'settings.terminal' },
  { id: 'updates', label: 'settings.updates' },
  { id: 'backup', label: 'settings.backup' },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsScreen({ settings, onChange, onQuit }: Props) {
  const [section, setSection] = useState<SectionId>('general');
  return (
    <div className="content">
      <PageHead crumb={t('settings.crumb')} title={t('settings.title')} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-nav-item${section === s.id ? ' active' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>
              {t(s.label)}
            </button>
          ))}
        </nav>
        <div className="scroll">
          {section === 'general' && <GeneralSection settings={settings} onChange={onChange} onQuit={onQuit} />}
          {section === 'layout' && (
            <section className="section">
              <h4 className="mono-label">{t('settings.layout')}</h4>
              <div className="card form">
                <ZoomField value={settings} onChange={onChange} />
              </div>
            </section>
          )}
          {section === 'keys' && <KeysCard settings={settings} onChange={onChange} />}
          {section === 'explorer' && <ExplorerCard settings={settings} onChange={onChange} />}
          {section === 'files' && <FileTypesCard value={settings.fileAssociations ?? []} onChange={(fileAssociations) => onChange({ fileAssociations })} />}
          {section === 'editors' && <EditorsCard />}
          {section === 'terminal' && <TerminalCard shell={settings.terminal?.shell ?? 'auto'} onShell={(shell) => onChange({ terminal: { shell } })} />}
          {section === 'updates' && <UpdatesCard folder={settings.updateFolder} onFolder={(updateFolder) => onChange({ updateFolder })} />}
          {section === 'backup' && <BackupCard onSettings={onChange} />}
        </div>
      </div>
    </div>
  );
}

function GeneralSection({ settings, onChange, onQuit }: Props) {
  return (
    <>
      <section className="section">
        <h4 className="mono-label">{t('settings.theme')}</h4>
        <div className="card form">
          <AppearanceFields value={settings} onChange={onChange} />
        </div>
      </section>
      <div className="card form">
        <label className="field">
          <span className="mono-label">{t('settings.language')}</span>
          <select value={settings.language ?? detectLanguage()} onChange={(e) => onChange({ language: e.target.value as Language })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <OnOffField
          label={t('settings.autostart')}
          hint={t('settings.autostart.hint')}
          value={settings.autostart}
          onChange={(autostart) => onChange({ autostart })}
        />
        <OnOffField
          label={t('settings.closeToTray')}
          hint={t('settings.closeToTray.hint')}
          value={settings.closeToTray}
          onChange={(closeToTray) => onChange({ closeToTray })}
        />
      </div>
      {(!isDesktop || settings.closeToTray) && <GeneralCard onQuit={onQuit} />}
    </>
  );
}

/** Every command of the app, with the keys the user can change; a change applies at once. */
function KeysCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const keys = useKeybindings();
  if (!keys) return null;
  const screens = NAV.flatMap((s) => s.items);
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : t(screens.find((i) => i.id === scope)?.label ?? 'nav.home'));
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.keys')}</h4>
      <div className="card form keys-card">
        <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onChange({ keybindings })} scopeLabel={scopeLabel} />
      </div>
    </section>
  );
}

function OnOffField({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="field">
      <span className="mono-label">{label}</span>
      <div className="chips">
        {([true, false] as const).map((on) => (
          <button key={String(on)} className={`chip${value === on ? ' chip-on' : ''}`} onClick={() => onChange(on)}>
            {t(on ? 'settings.on' : 'settings.off')}
          </button>
        ))}
      </div>
      <span className="muted">{hint}</span>
    </div>
  );
}

/** Saving text files, like VS Code's `files.*` settings; the Explorer's file tabs read them. */
function ExplorerCard({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const files = fileSettingsOf(settings.files);
  const set = (patch: Partial<typeof files>) => onChange({ files: { ...files, ...patch } });
  return (
    <>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.saving')}</h4>
      <div className="card form">
        <div className="field">
          <span className="mono-label">{t('settings.explorer.autoSave')}</span>
          <div className="chips">
            {AUTO_SAVE.map((mode: AutoSave) => (
              <button key={mode} className={`chip${files.autoSave === mode ? ' chip-on' : ''}`} onClick={() => set({ autoSave: mode })}>
                {t(`settings.explorer.autoSave.${mode}`)}
              </button>
            ))}
          </div>
          <span className="muted">{t('settings.explorer.autoSave.hint')}</span>
        </div>
        <OnOffField
          label={t('settings.explorer.trim')}
          hint={t('settings.explorer.trim.hint')}
          value={files.trimTrailingWhitespace}
          onChange={(trimTrailingWhitespace) => set({ trimTrailingWhitespace })}
        />
        <OnOffField
          label={t('settings.explorer.finalNewline')}
          hint={t('settings.explorer.finalNewline.hint')}
          value={files.insertFinalNewline}
          onChange={(insertFinalNewline) => set({ insertFinalNewline })}
        />
      </div>
    </section>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.tabs')}</h4>
      <div className="card form">
        <OnOffField
          label={t('settings.explorer.previewTabs')}
          hint={t('settings.explorer.previewTabs.hint')}
          value={files.previewTabs}
          onChange={(previewTabs) => set({ previewTabs })}
        />
        <OnOffField
          label={t('settings.explorer.autoReveal')}
          hint={t('settings.explorer.autoReveal.hint')}
          value={files.autoReveal}
          onChange={(autoReveal) => set({ autoReveal })}
        />
        <OnOffField
          label={t('settings.explorer.breadcrumbs')}
          hint={t('settings.explorer.breadcrumbs.hint')}
          value={files.breadcrumbs}
          onChange={(breadcrumbs) => set({ breadcrumbs })}
        />
      </div>
    </section>
    <section className="section">
      <h4 className="mono-label">{t('settings.explorer.view')}</h4>
      <div className="card form">
        <OnOffField
          label={t('settings.explorer.compact')}
          hint={t('settings.explorer.compact.hint')}
          value={files.compactFolders}
          onChange={(compactFolders) => set({ compactFolders })}
        />
        <div className="field">
          <span className="mono-label">{t('settings.explorer.sort')}</span>
          <div className="chips">
            {SORT_ORDERS.map((order) => (
              <button key={order} className={`chip${files.sortOrder === order ? ' chip-on' : ''}`} onClick={() => set({ sortOrder: order })}>
                {t(`settings.explorer.sort.${order}`)}
              </button>
            ))}
          </div>
          <span className="muted">{t('settings.explorer.sort.hint')}</span>
        </div>
        <OnOffField
          label={t('settings.explorer.nesting')}
          hint={t('settings.explorer.nesting.hint')}
          value={files.fileNesting}
          onChange={(fileNesting) => set({ fileNesting })}
        />
        {files.fileNesting && <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => set({ nestingPatterns })} />}
        <ExcludeField value={files.exclude} onChange={(exclude) => set({ exclude })} />
      </div>
    </section>
    </>
  );
}

function NestingField({ value, onChange }: { value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const [text, setText] = useState(Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(String.fromCharCode(10)));
  return (
    <div className="field">
      <span className="mono-label">{t('settings.explorer.nesting.patterns')}</span>
      <textarea
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
  );
}

function ExcludeField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <div className="field">
      <span className="mono-label">{t('settings.explorer.exclude')}</span>
      <textarea
        value={text}
        rows={4}
        spellCheck={false}
        aria-label={t('settings.explorer.exclude')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split('\n').map((l) => l.trim()).filter(Boolean))}
      />
      <span className="muted">{t('settings.explorer.exclude.hint')}</span>
    </div>
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
      <h4 className="mono-label">{t('settings.general')}</h4>
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
      <h4 className="mono-label">{t('settings.files')}</h4>
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

/** Product names of the shell ids; not translated. */
const SHELL_NAMES: Record<string, string> = {
  powershell: 'Windows PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'cmd',
  'git-bash': 'Git Bash',
  wsl: 'WSL',
};

function TerminalCard({ shell, onShell }: { shell: string; onShell: (shell: string) => void }) {
  const shells = useAsync(() => api.terminalShells(), []);
  return (
    <section className="section">
      <h4 className="mono-label">{t('settings.terminal')}</h4>
      <div className="card form">
        {shells.error && <ErrorBanner error={shells.error} onRetry={shells.reload} compact />}
        <label className="field">
          <span className="mono-label">{t('settings.terminal.shell')}</span>
          <select value={shell} disabled={!shells.data} onChange={(e) => onShell(e.target.value)}>
            <option value="auto">{t('settings.terminal.auto')}</option>
            {shells.data?.filter((id) => id !== 'auto').map((id) => <option key={id} value={id}>{SHELL_NAMES[id] ?? id}</option>)}
          </select>
          <span className="muted">{t('settings.terminal.hint')}</span>
        </label>
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
      <h4 className="mono-label">{t('settings.editors')}</h4>
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
      <h4 className="mono-label">{t('settings.updates')}</h4>
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
      <h4 className="mono-label">{t('settings.backup')}</h4>
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
