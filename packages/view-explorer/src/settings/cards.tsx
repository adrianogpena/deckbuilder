import { useState } from 'react';
import { deepEqual, FILE_DEFAULTS, fileSettingsOf, SettingItem, type SettingsCardProps, type SettingsFieldProps, useResync } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { ExplorerViewSettings } from '../settings';

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

/** How the Explorer tree and its tabs behave (`files.*` settings, shared with the file tabs). */
export function ExplorerCard({ settings, onChange, row }: SettingsCardProps<ExplorerViewSettings>) {
  const files = fileSettingsOf(settings.files);
  const set = (patch: Partial<typeof files>) => onChange({ files: { ...files, ...patch } });
  return (
    <>
      <section className="section">
        <h4 className="mono-label">{t('settings.explorer.tabs')}</h4>
        <div className="card form">
          {['previewTabs', 'autoReveal', 'breadcrumbs', 'restoreTabs', 'markdownToc'].map((k) => row(`files.${k}`))}
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
