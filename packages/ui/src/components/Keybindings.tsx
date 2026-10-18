import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { isDesktop } from '../api';
import { isTyping } from '../hooks';
import { chordOf, firesInInput, inFocusScope, ownsKey, resolve, startsOf, type CommandDef, type Keymap } from '../keybindings';
import { isModalOpen } from './ui';

interface Handler {
  def: CommandDef;
  run: () => void;
  enabled: boolean;
}
type HandlerRef = MutableRefObject<Handler>;

export interface KeybindingsValue {
  defs: CommandDef[];
  keymap: Keymap;
  /** The view whose commands win over global ones: the app's current screen id. */
  scope: string;
}

interface Registry extends KeybindingsValue {
  runCommand: (id: string) => boolean;
  register: (handler: HandlerRef) => () => void;
}

const Ctx = createContext<Registry | null>(null);

/** How long the next step of a multi-step binding may take. */
const SEQUENCE_TIMEOUT = 1500;

/** `continuing`: a later step of a sequence, already allowed while typing by its first step. */
function blocked(e: KeyboardEvent, def: CommandDef, chord: string, continuing = false): boolean {
  return ownsKey(e.target, def.id) || !inFocusScope(e.target, def.focus) || (!continuing && isTyping(e) && !firesInInput(def, chord)) || (isModalOpen() && !def.inModal);
}

/**
 * Dispatches app shortcuts: one window `keydown` listener (bubble phase, so widgets that
 * `preventDefault` keep their keys) runs the handler `useCommand` registered for the command the
 * chord resolves to, the `scope` view's first, then a global one. `keymap` overrides `defs`' keys.
 * A command registered with `useCommand` but missing from `defs` keeps its default keys.
 */
export function KeybindingProvider({ defs, keymap, scope, sequenceTimeout = SEQUENCE_TIMEOUT, children }: KeybindingsValue & { sequenceTimeout?: number; children: ReactNode }) {
  const registry = useRef(new Map<string, HandlerRef[]>());
  const latest = useRef({ defs, keymap, scope, sequenceTimeout });
  latest.current = { defs, keymap, scope, sequenceTimeout };

  useEffect(() => {
    // Steps already pressed of a multi-step binding, forgotten after SEQUENCE_TIMEOUT.
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      pending = '';
      clearTimeout(timer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const step = chordOf(e);
      if (!step) return;
      const continuing = pending !== '';
      const chord = continuing ? `${pending} ${step}` : step;
      clear();
      // Newest enabled registration of each command.
      const live = new Map<string, Handler>();
      for (const [id, list] of registry.current) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].current.enabled) {
            live.set(id, list[i].current);
            break;
          }
        }
      }
      const { defs, keymap, scope } = latest.current;
      const known = new Set(defs.map((d) => d.id));
      const candidates = [
        ...defs.filter((d) => live.has(d.id)),
        ...[...live.values()].filter((h) => !known.has(h.def.id)).map((h) => h.def),
      ];
      const def = resolve(chord, scope, candidates, keymap, { desktop: isDesktop });
      if (def) {
        if (blocked(e, def, chord, continuing)) return;
        e.preventDefault();
        live.get(def.id)!.run();
        return;
      }
      const starters = startsOf(chord, scope, candidates, keymap, { desktop: isDesktop });
      if (starters.some((d) => !blocked(e, d, chord, continuing))) {
        e.preventDefault();
        pending = chord;
        timer = setTimeout(clear, latest.current.sequenceTimeout);
      } else if (continuing) {
        // A key that breaks a started sequence is swallowed, so it doesn't type or trigger something else.
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clear();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Stable, so a keymap or scope change doesn't re-register (and reorder) the handlers.
  const register = useCallback((handler: HandlerRef) => {
    const id = handler.current.def.id;
    const list = registry.current.get(id) ?? [];
    list.push(handler);
    registry.current.set(id, list);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
      if (!list.length && registry.current.get(id) === list) registry.current.delete(id);
    };
  }, []);
  const runCommand = useCallback((id: string) => {
    const list = registry.current.get(id) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].current.enabled) {
        list[i].current.run();
        return true;
      }
    }
    return false;
  }, []);
  const value = useMemo<Registry>(() => ({ defs, keymap, scope, register, runCommand }), [defs, keymap, scope, register, runCommand]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Runs `run` when one of the command's chords is pressed. Under a `KeybindingProvider` the chords
 * come from its keymap; without one, from `def.keys` (and `desktopOnly` follows `isDesktop`).
 */
export function useCommand(def: CommandDef, run: () => void, { enabled = true }: { enabled?: boolean } = {}) {
  const ctx = useContext(Ctx);
  const handler = useRef<Handler>({ def, run, enabled });
  handler.current = { def, run, enabled };
  const register = ctx?.register;

  useEffect(() => {
    if (register) return register(handler);
    const onKey = (e: KeyboardEvent) => {
      const h = handler.current;
      if (!h.enabled || e.defaultPrevented || e.isComposing || (h.def.desktopOnly && !isDesktop)) return;
      const chord = chordOf(e);
      if (!chord || !h.def.keys.includes(chord) || blocked(e, h.def, chord)) return;
      e.preventDefault();
      h.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [register, def.id]);
}

/** The provider's defs, keymap and scope; null without a `KeybindingProvider`. */
export function useKeybindings(): KeybindingsValue | null {
  const ctx = useContext(Ctx);
  return useMemo(() => (ctx ? { defs: ctx.defs, keymap: ctx.keymap, scope: ctx.scope } : null), [ctx]);
}

/** Runs the newest enabled handler of a command by id (true when one ran); a no-op without a `KeybindingProvider`. */
export function useRunCommand(): (id: string) => boolean {
  const ctx = useContext(Ctx);
  return ctx?.runCommand ?? (() => false);
}
