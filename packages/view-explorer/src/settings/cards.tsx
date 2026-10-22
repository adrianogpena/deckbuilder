import { useState } from 'react';
import { deepEqual, FILE_DEFAULTS, fileSettingsOf, SettingDescription, SettingItem, type SettingsCardProps, type SettingsFieldProps, useResync } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { ExplorerViewSettings } from '../settings';
import { MARKDOWN_STORED_DEFAULTS, markdownStoredOf, READING_PERCENT_MAX, READING_PERCENT_MIN, readingPercent, READING_WIDTH_MAX, READING_WIDTH_MIN, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type MarkdownStored } from './markdown';

function NestingField({ value, onChange }: { value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const toText = (v: Record<string, string>) => Object.entries(v).map(([k, c]) => `${k}: ${c}`).join(String.fromCharCode(10));
  const [text, setText] = useState(toText(value));
  const area = useResync(value, () => setText(toText(value)));
  return (
    <SettingItem id="files.nestingPatterns" modified={!deepEqual(value, FILE_DEFAULTS.nestingPatterns)}>
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
  return (
    <SettingItem id="files.exclude" modified={!deepEqual(value, FILE_DEFAULTS.exclude)}>
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

/** The hand-written rows of the `files.nestingPatterns` and `files.exclude` settings (search results show them too). */
export function NestingSettingField({ settings, onChange }: SettingsFieldProps<ExplorerViewSettings>) {
  const files = fileSettingsOf(settings.files);
  return <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => onChange({ files: { ...files, nestingPatterns } })} />;
}

export function ExcludeSettingField({ settings, onChange }: SettingsFieldProps<ExplorerViewSettings>) {
  const files = fileSettingsOf(settings.files);
  return <ExcludeField value={files.exclude} onChange={(exclude) => onChange({ files: { ...files, exclude } })} />;
}

function ReadingWidthField({ value, onChange }: { value: MarkdownStored['readingWidth']; onChange: (next: MarkdownStored['readingWidth']) => void }) {
  const custom = typeof value === 'number';
  const percent = readingPercent(value);
  const relative = percent !== null;
  const [text, setText] = useState(String(custom ? value : 80));
  const [pctText, setPctText] = useState(String(percent ?? 70));
  const kind = custom ? 'chars' : relative ? 'relative' : value;
  const pick = (k: string) => {
    if (k === 'chars') onChange(Number(text) >= READING_WIDTH_MIN && Number(text) <= READING_WIDTH_MAX ? Number(text) : 80);
    else if (k === 'relative') onChange(`${Number(pctText) >= READING_PERCENT_MIN && Number(pctText) <= READING_PERCENT_MAX ? Number(pctText) : 70}%`);
    else onChange(k as 'comfortable' | 'full');
  };
  return (
    <SettingItem id="markdown.readingWidth" modified={value !== MARKDOWN_STORED_DEFAULTS.readingWidth}>
      <div className="field">
        <span className="mono-label">{t('settings.explorer.markdownReadingWidth')}</span>
        <div className="chips">
          {['comfortable', 'relative', 'full', 'chars'].map((k) => (
            <button key={k} className={`chip${kind === k ? ' chip-on' : ''}`} onClick={() => pick(k)} title={t(`settings.explorer.markdownReadingWidth.${k}` as 'settings.explorer.markdownReadingWidth.chars')}>
              {t(`settings.explorer.markdownReadingWidth.${k}` as 'settings.explorer.markdownReadingWidth.chars')}
            </button>
          ))}
        </div>
        {custom && (
          <input
            type="number"
            min={READING_WIDTH_MIN}
            max={READING_WIDTH_MAX}
            value={text}
            aria-label={t('settings.explorer.markdownReadingWidth.chars')}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isInteger(n) && n >= READING_WIDTH_MIN && n <= READING_WIDTH_MAX) onChange(n);
            }}
            onBlur={() => setText(String(value))}
          />
        )}
        {relative && (
          <input
            type="number"
            min={READING_PERCENT_MIN}
            max={READING_PERCENT_MAX}
            value={pctText}
            aria-label={t('settings.explorer.markdownReadingWidth.relative')}
            onChange={(e) => {
              setPctText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isInteger(n) && n >= READING_PERCENT_MIN && n <= READING_PERCENT_MAX) onChange(`${n}%`);
            }}
            onBlur={() => setPctText(String(percent))}
          />
        )}
        <span className="muted"><SettingDescription text={t('settings.explorer.markdownReadingWidth.hint')} /></span>
      </div>
    </SettingItem>
  );
}

function ZoomField({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <SettingItem id="markdown.zoom" modified={value !== MARKDOWN_STORED_DEFAULTS.zoom}>
      <label className="field">
        <span className="mono-label">{t('settings.explorer.markdownZoom')}</span>
        <input
          type="number"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== '' && Number.isInteger(n) && n >= ZOOM_MIN && n <= ZOOM_MAX && n % ZOOM_STEP === 0) onChange(n);
          }}
          onBlur={() => setText(String(value))}
        />
        <span className="muted"><SettingDescription text={t('settings.explorer.markdownZoom.hint')} /></span>
      </label>
    </SettingItem>
  );
}

/** The hand-written rows of the `markdown.readingWidth` and `markdown.zoom` settings (search results show them too). */
export function ReadingWidthSettingField({ settings, onChange }: SettingsFieldProps<ExplorerViewSettings>) {
  const md = markdownStoredOf(settings.markdown);
  return <ReadingWidthField value={md.readingWidth} onChange={(readingWidth) => onChange({ markdown: { ...md, readingWidth } })} />;
}

export function ZoomSettingField({ settings, onChange }: SettingsFieldProps<ExplorerViewSettings>) {
  const md = markdownStoredOf(settings.markdown);
  return <ZoomField key={md.zoom} value={md.zoom} onChange={(zoom) => onChange({ markdown: { ...md, zoom } })} />;
}

/** How the Explorer tree and its tabs behave (`files.*` settings, shared with the file tabs). */
export function ExplorerCard({ settings, onChange, row }: SettingsCardProps<ExplorerViewSettings>) {
  const files = fileSettingsOf(settings.files);
  const set = (patch: Partial<typeof files>) => onChange({ files: { ...files, ...patch } });
  const md = markdownStoredOf(settings.markdown);
  const setMd = (patch: Partial<MarkdownStored>) => onChange({ markdown: { ...md, ...patch } });
  return (
    <>
      <section className="section">
        <h4 className="mono-label">{t('settings.explorer.tabs')}</h4>
        <div className="card form">
          {['previewTabs', 'autoReveal', 'breadcrumbs', 'restoreTabs'].map((k) => row(`files.${k}`))}
        </div>
      </section>
      <section className="section">
        <h4 className="mono-label">{t('settings.explorer.markdown')}</h4>
        <div className="card form">
          {row('markdown.defaultMode')}
          <ReadingWidthField value={md.readingWidth} onChange={(readingWidth) => setMd({ readingWidth })} />
          <ZoomField key={md.zoom} value={md.zoom} onChange={(zoom) => setMd({ zoom })} />
          {row('markdown.mermaid')}
          {row('markdown.headingLinks')}
          {row('markdown.lineNumbers')}
          {row('markdown.lineBreaks')}
          {row('files.markdownToc')}
        </div>
      </section>
      <section className="section">
        <h4 className="mono-label">{t('settings.explorer.view')}</h4>
        <div className="card form">
          {row('files.compactFolders')}
          {row('files.sortOrder')}
          {row('files.fileNesting')}
          {row('git.explorerDecorations')}
          {row('files.showHidden')}
          {row('files.confirmDelete')}
          {row('files.confirmDragDrop')}
          {files.fileNesting && <NestingField value={files.nestingPatterns} onChange={(nestingPatterns) => set({ nestingPatterns })} />}
          <ExcludeField value={files.exclude} onChange={(exclude) => set({ exclude })} />
        </div>
      </section>
    </>
  );
}
