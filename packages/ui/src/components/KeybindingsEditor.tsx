import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { chordOf, conflictsOf, effectiveKeys, GLOBAL, MAX_STEPS, relatedChords, stepsOf, type CommandDef, type Keymap } from '../keybindings';
import { Icon, useDialogs } from './ui';

const MAX_CHORDS = 4;
/** Keys pressed within this many ms of each other make one multi-step shortcut. */
const STEP_WINDOW = 1200;

export interface KeybindingsEditorProps {
  defs: CommandDef[];
  keymap: Keymap;
  onChange: (next: Keymap) => void;
  /** Display name of a scope: the app's name for a screen id, and for `GLOBAL`. */
  scopeLabel: (scope: string) => string;
}

interface Edit {
  id: string;
  /** Index of the chord being replaced; -1 adds one. */
  index: number;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/** Runs `onKey` for every key press, ahead of the window listeners that would run commands. */
function useCapturedKeys(active: boolean, onKey: (e: KeyboardEvent) => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onKey(e);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  });
}

/** Lists every command with its shortcuts and edits them; refuses a chord another command uses. */
export function KeybindingsEditor({ defs, keymap, onChange, scopeLabel }: KeybindingsEditorProps) {
  const [filter, setFilter] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const findPress = useRef(0);
  const findTimer = useRef(0);
  const { confirm, element } = useDialogs();

  const keys = useMemo(() => effectiveKeys(defs, keymap), [defs, keymap]);
  const byId = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const labelOf = (id: string) => byId.get(id)?.label ?? id;

  const setKeys = (def: CommandDef, chords: string[]) => {
    const next = { ...keymap };
    if (sameList(chords, def.keys)) delete next[def.id];
    else next[def.id] = chords;
    onChange(next);
  };

  useCapturedKeys(finding, (e) => {
    if (e.key === 'Escape') {
      setFinding(false);
      return;
    }
    const chord = chordOf(e);
    if (!chord) return;
    const now = Date.now();
    const quick = now - findPress.current < STEP_WINDOW;
    findPress.current = now;
    setFound((prev) => (prev && quick && stepsOf(prev).length < MAX_STEPS ? `${prev} ${chord}` : chord));
    window.clearTimeout(findTimer.current);
    findTimer.current = window.setTimeout(() => setFinding(false), STEP_WINDOW);
  });

  const needle = filter.trim().toLowerCase();
  const visible = defs.filter((d) => {
    if (found && !(keys.get(d.id) ?? []).some((c) => relatedChords(found, c))) return false;
    if (!needle) return true;
    return [d.label, d.id, ...(keys.get(d.id) ?? [])].some((text) => text.toLowerCase().includes(needle));
  });
  const scopes = [...new Set(defs.map((d) => d.scope))].sort((a, b) => Number(b === GLOBAL) - Number(a === GLOBAL));

  const resetAll = async () => {
    const ok = await confirm({ title: t('keys.resetAll'), body: t('keys.resetAllBody'), danger: true });
    if (ok) {
      setEdit(null);
      onChange({});
    }
  };

  return (
    <div className="keys">
      <div className="keys-bar">
        <input value={filter} placeholder={t('keys.filter')} aria-label={t('keys.filter')} onChange={(e) => setFilter(e.target.value)} />
        <button title={finding ? t('keys.finding') : t('keys.find')}
          className={`btn btn-sm${finding ? ' btn-primary' : ''}`}
          data-keys-search
          onClick={() => {
            setFound(null);
            setEdit(null);
            findPress.current = 0;
            window.clearTimeout(findTimer.current);
            setFinding(!finding);
          }}
        >
          <Icon name="search" /> {finding ? t('keys.finding') : t('keys.find')}
        </button>
        {found && (
          <span className="chip chip-on keys-found">
            <kbd>{found}</kbd>
            <button className="keys-x" onClick={() => setFound(null)} title={t('output.clear')} aria-label={t('output.clear')}>
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
        <span className="spacer" />
        <button title={t('keys.resetAll')} className="btn btn-sm" disabled={Object.keys(keymap).length === 0} onClick={resetAll}>
          <Icon name="refresh" /> {t('keys.resetAll')}
        </button>
      </div>
      <span className="muted small">{t('keys.browserNote')}</span>
      {found && visible.length === 0 && <span className="muted">{t('keys.noUse', { chord: found })}</span>}
      {!found && visible.length === 0 && <span className="muted">{t('keys.none')}</span>}
      {scopes.map((scope) => {
        const rows = visible.filter((d) => d.scope === scope);
        if (!rows.length) return null;
        return (
          <section key={scope} className="keys-group">
            <h5 className="mono-label">{scopeLabel(scope)}</h5>
            {rows.map((def) => {
              const chords = keys.get(def.id) ?? [];
              const editing = edit?.id === def.id ? edit : null;
              return (
                <div key={def.id} className="keys-row">
                  <div className="keys-label">
                    <span>{def.label}</span>
                    <span className="mono muted small">{def.id}</span>
                    <div className="keys-meta">
                      <span className="badge badge-muted">{scopeLabel(def.scope)}</span>
                      {def.desktopOnly && <span className="badge badge-info">{t('keys.desktopOnly')}</span>}
                      {!Object.hasOwn(keymap, def.id) && <span className="muted small">{t('keys.default')}</span>}
                    </div>
                  </div>
                  <div className="keys-chords">
                    {chords.length === 0 && <span className="muted">{t('keys.unbound')}</span>}
                    {chords.map((chord, i) => (
                      <span key={chord} className="keys-chord">
                        <button className="keys-chord-key" onClick={() => setEdit({ id: def.id, index: i })} title={t('keys.edit')}>
                          <kbd>{chord}</kbd>
                        </button>
                        <button
                          className="keys-x"
                          onClick={() => {
                            setEdit(null);
                            setKeys(def, chords.filter((_, j) => j !== i));
                          }}
                          title={t('keys.remove')}
                          aria-label={`${t('keys.remove')}: ${chord}`}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                    {chords.length < MAX_CHORDS && (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEdit({ id: def.id, index: -1 })} title={t('keys.add')} aria-label={t('keys.add')}>
                        <Icon name="plus" />
                      </button>
                    )}
                    {Object.hasOwn(keymap, def.id) && (
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={() => {
                          setEdit(null);
                          setKeys(def, [...def.keys]);
                        }}
                        title={t('keys.reset')}
                        aria-label={t('keys.reset')}
                      >
                        <Icon name="refresh" />
                      </button>
                    )}
                  </div>
                  {editing && (
                    <ChordRecorder
                      key={`${editing.id}:${editing.index}`}
                      def={def}
                      defs={defs}
                      keymap={keymap}
                      chords={chords}
                      index={editing.index}
                      scopeLabel={scopeLabel}
                      labelOf={labelOf}
                      onSave={(next) => {
                        setEdit(null);
                        setKeys(def, next);
                      }}
                      onCancel={() => setEdit(null)}
                    />
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {element}
    </div>
  );
}

interface RecorderProps {
  def: CommandDef;
  defs: CommandDef[];
  keymap: Keymap;
  chords: string[];
  index: number;
  scopeLabel: (scope: string) => string;
  labelOf: (id: string) => string;
  onSave: (chords: string[]) => void;
  onCancel: () => void;
}

/** Records one chord for `def`, showing what it would clash with; Save stays off while it clashes. */
function ChordRecorder({ def, defs, keymap, chords, index, scopeLabel, labelOf, onSave, onCancel }: RecorderProps) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const lastPress = useRef(0);

  const withCandidate = (chord: string) => (index < 0 ? [...chords, chord] : chords.map((c, i) => (i === index ? chord : c)));

  useCapturedKeys(true, (e) => {
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Backspace' && plain) {
      if (index < 0) onCancel();
      else onSave(chords.filter((_, i) => i !== index));
      return;
    }
    const chord = chordOf(e);
    if (!chord) return;
    // A key pressed soon after the previous one adds a step; after a pause it starts over.
    const now = Date.now();
    const quick = now - lastPress.current < STEP_WINDOW;
    lastPress.current = now;
    setCandidate((prev) => (prev && quick && stepsOf(prev).length < MAX_STEPS ? `${prev} ${chord}` : chord));
  });

  const problems: string[] = [];
  if (candidate) {
    if (chords.some((c, i) => c === candidate && i !== index)) problems.push(t('keys.duplicate'));
    const clash = conflictsOf(defs, { ...keymap, [def.id]: withCandidate(candidate) }).find((c) => relatedChords(c.chord, candidate) && c.ids.includes(def.id));
    for (const id of clash?.ids ?? []) {
      const other = defs.find((d) => d.id === id);
      if (!other || other.id === def.id) continue;
      if (other.scope === def.scope || other.scope === GLOBAL || def.scope === GLOBAL) {
        problems.push(t('keys.usedBy', { label: labelOf(id), scope: scopeLabel(other.scope) }));
      }
    }
  }

  return (
    <div className="keys-edit">
      <span className="keys-press">{candidate ? <kbd>{candidate}</kbd> : <span className="muted">{t('keys.press')}</span>}</span>
      {problems.map((p) => <span key={p} className="tone-err small">{p}</span>)}
      <span className="spacer" />
      <button title={t('dialog.cancel')} className="btn btn-sm" onClick={onCancel}>{t('dialog.cancel')}</button>
      <button title={t('resource.save')} className="btn btn-sm btn-primary" disabled={!candidate || problems.length > 0} onClick={() => candidate && onSave(withCandidate(candidate))}>
        {t('resource.save')}
      </button>
    </div>
  );
}
