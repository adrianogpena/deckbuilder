import { useEffect, useRef, useState } from 'react';
import { applyEol, CodeEditor, langLabel, langOfFile, prepareForSave, type SelectionInfo, useEditorOptions } from '@deckbuilderkit/editor';
import { type ApiError, dialogs, errorOf, ErrorBanner, FILE_DEFAULTS, type FileSettings, relPath, StatusBar, type StatusItem, type TabAction, useCommand, useDialogs, useToast } from '@deckbuilderkit/ui';
import { explorerApi as api } from '../client';
import { explorerCommandById as commandById } from '../commands';
import { t } from '../i18n';
import { useExplorerCurl } from './CurlPanel';
import { OS_EOL, positionText } from './FileTab';
import { type ExplorerSqlProps, useExplorerSql } from './SqlPanel';
import { useChordOf, useTabActions } from './tab-actions';
import { UNTITLED_SYNTAXES, type UntitledSyntax, untitledName } from './untitled';

export interface UntitledTabProps {
  /** Syntax id (see `UNTITLED_SYNTAXES`), the text, and the absolute file a save outside the projects wrote. */
  lang: string;
  text: string;
  target?: string;
  /** The text equals what was last written to `target`. */
  saved?: boolean;
  /** Project whose SQL settings apply, and the folder the save dialog starts in. */
  project?: string;
  start?: string;
  focused: boolean;
  wrapLines?: boolean;
  onWrapLinesChange?: (wrap: boolean) => void;
  files?: Required<FileSettings>;
  sql?: ExplorerSqlProps;
  onChange: (patch: { lang?: string; text?: string; saved?: boolean }) => void;
  /** The text was written to absolute `path`. */
  onSaved: (path: string, text: string) => void;
  onDirty?: (dirty: boolean) => void;
  onSaver?: (save: (() => Promise<boolean>) | undefined) => void;
  onActions?: (actions: TabAction[]) => void;
}

const syntaxLabel = (id: UntitledSyntax) => (id === 'curl' ? 'cURL' : langLabel(langOfFile(untitledName(id))));

/** A new tab: an empty editor of a chosen syntax, saved anywhere with the save dialog. */
export function UntitledTab({ lang, text, target, saved, project = '', start, focused, wrapLines: wrapProp, onWrapLinesChange, files = FILE_DEFAULTS, sql, onChange, onSaved, onDirty, onSaver, onActions }: UntitledTabProps) {
  const wrapLines = wrapProp ?? useEditorOptions()?.wordWrap ?? true;
  const name = untitledName(lang);
  const editorLang = langOfFile(name);
  const [draft, setDraft] = useState(text);
  const [selection, setSelection] = useState<SelectionInfo>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError>();
  const { confirm, element } = useDialogs();
  const toast = useToast();
  const chordOf = useChordOf();
  const dirty = !saved && (draft !== '' || !!target);

  const edit = (v: string) => {
    setDraft(v);
    onChange({ text: v, saved: false });
  };

  const save = async (): Promise<boolean> => {
    if (target && !dirty) return true;
    if (saving) return false;
    setSaving(true);
    setSaveError(undefined);
    const out = prepareForSave(draft, { trim: files.trimTrailingWhitespace, finalNewline: files.insertFinalNewline, markdown: editorLang === 'markdown' });
    try {
      const text = applyEol(out, OS_EOL);
      const pick = async (suggestedName: string, dir: string | undefined) => {
        const ext = /\.([^./]+)$/.exec(suggestedName)?.[1] ?? '';
        const chosen = await dialogs.saveAs({
          purpose: 'untitled',
          suggestedName,
          ...(dir && { start: dir }),
          filters: [...(ext ? [{ name: ext.toUpperCase(), patterns: [`*.${ext}`] }] : []), { name: 'All files', patterns: ['*.*'] }],
        });
        return chosen === null ? null : api.fsSaveNew({ text, target: chosen });
      };
      let res: { path: string } | null;
      if (target) {
        try {
          res = await api.fsSaveNew({ text, path: target });
        } catch (err) {
          if (errorOf(err).code !== 'notASaveTarget') throw err;
          const cut = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
          res = await pick(target.slice(cut + 1), cut > 0 ? target.slice(0, cut) : undefined);
        }
      } else res = await pick(name, start);
      if (res === null) return false;
      setDraft(out);
      toast({ message: t('explorer.savedTo', { path: res.path }) });
      onSaved(res.path, out);
      return true;
    } catch (err) {
      setSaveError(errorOf(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  useCommand(commandById('explorer.file.save'), () => void save(), { enabled: focused });
  const toggleWrap = () => onWrapLinesChange?.(!wrapLines);
  useCommand(commandById('explorer.file.wrap'), toggleWrap, { enabled: focused && Boolean(onWrapLinesChange) });

  const saveRef = useRef(save);
  saveRef.current = save;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onSaverRef = useRef(onSaver);
  onSaverRef.current = onSaver;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    onSaverRef.current?.(() => saveRef.current());
    return () => {
      onSaverRef.current?.(undefined);
      onDirtyRef.current?.(false);
    };
  }, []);

  const sqlUi = useExplorerSql({ project, name, asSql: false, active: true, focused, draft, sql, confirm, onRunStart: () => {} });
  const curlUi = useExplorerCurl({ name, active: true, draft, sql });

  const actions: TabAction[] = [
    {
      id: 'syntax',
      group: 'primary',
      label: t('explorer.syntax'),
      options: (Object.keys(UNTITLED_SYNTAXES) as UntitledSyntax[]).map((id) => ({ value: id, label: syntaxLabel(id) })),
      value: lang,
      run: (v) => v && v !== lang && onChange({ lang: v }),
    },
    ...sqlUi.actions,
    ...curlUi.actions,
  ];
  if (onWrapLinesChange) {
    actions.push({ id: 'wrap', group: 'menu', section: 'view', label: t('explorer.wrap'), hint: chordOf('explorer.file.wrap'), checked: wrapLines, run: toggleWrap });
  }
  actions.push({ id: 'save', group: 'menu', section: 'file', label: t('explorer.save'), hint: chordOf('explorer.file.save'), disabled: saving || (!!target && !dirty), run: () => void save() });
  useTabActions(actions, onActions);

  const status: StatusItem[] = [];
  if (selection) status.push({ id: 'position', text: positionText(selection) });
  if (target) status.push({ id: 'target', text: relPath.basename(target.replace(/\\/g, '/')), title: target });
  status.push({ id: 'language', text: langLabel(editorLang), title: t('explorer.status.language') });

  return (
    <div className="xp-file">
      {element}
      {saveError && <ErrorBanner error={saveError} compact />}
      <div className="xp-body">
        {curlUi.enabled
          ? curlUi.layout(<CodeEditor ref={curlUi.editor} value={draft} lang={editorLang} onChange={edit} height="100%" wrap={wrapLines} autoFocus onSelection={setSelection} {...curlUi.editorProps} />)
          : sqlUi.layout(<CodeEditor ref={sqlUi.editor} value={draft} lang={editorLang} onChange={edit} height="100%" wrap={wrapLines} autoFocus onSelection={setSelection} sqlLint={editorLang === 'sql'} {...sqlUi.editorProps} />)}
      </div>
      <StatusBar items={status} />
    </div>
  );
}
