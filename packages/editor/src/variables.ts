import { REST_BUILTIN_VARIABLES, type RestEnvVar, restVarRefs } from '@kedalion/server-core/protocol';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { t } from '@kedalion/ui/i18n';

export interface VariableInfo {
  defined: boolean;
  /** Hover text: the value of a plain variable, a label for secret, built-in or undefined ones. */
  title: string;
}

/** Whether `name` resolves against `vars` (enabled ones; a secret one only when set) or the built-ins. */
export function variableInfo(name: string, vars: readonly RestEnvVar[]): VariableInfo {
  if ((REST_BUILTIN_VARIABLES as readonly string[]).includes(name)) return { defined: true, title: t('http.varBuiltin', { name }) };
  const v = vars.find((x) => x.enabled && x.name === name && (!x.secret || x.set));
  if (!v) return { defined: false, title: t('http.varUndefined', { name }) };
  return { defined: true, title: v.secret ? t('http.varSecret', { name }) : `${name} = ${v.value}` };
}

export const variableClass = (defined: boolean) => `req-var ${defined ? 'req-var-ok' : 'req-var-bad'}`;

function decorate(view: EditorView, vars: readonly RestEnvVar[]): DecorationSet {
  const marks = restVarRefs(view.state.doc.toString()).map(({ name, from, to }) => {
    const info = variableInfo(name, vars);
    return Decoration.mark({ class: variableClass(info.defined), attributes: { title: info.title } }).range(from, to);
  });
  return Decoration.set(marks);
}

/** Marks `{{name}}` green when defined, red when not; the title shows the value (never a secret one). */
export function variableHighlight(vars: readonly RestEnvVar[]): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view, vars);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = decorate(u.view, vars);
    }
  }, { decorations: (p) => p.decorations });
}

/** A variable `{{` can complete to: its name and what the list shows beside it. */
export interface VariableOption {
  name: string;
  /** The value, or a label for a secret or built-in one. */
  detail: string;
}

/** The names `{{` offers: enabled variables (a secret one only when set), then the built-ins. */
export function variableOptions(vars: readonly RestEnvVar[]): VariableOption[] {
  const out: VariableOption[] = [];
  const seen = new Set<string>();
  for (const v of vars) {
    if (!v.enabled || (v.secret && !v.set) || seen.has(v.name)) continue;
    seen.add(v.name);
    out.push({ name: v.name, detail: v.secret ? t('http.varTagSecret') : v.value });
  }
  for (const name of REST_BUILTIN_VARIABLES) out.push({ name, detail: t('http.varTagBuiltin') });
  return out;
}

/** The options whose name contains `partial` (ignoring case), those starting with it first. */
export function filterVariableOptions(options: readonly VariableOption[], partial: string): VariableOption[] {
  const p = partial.toLowerCase();
  const hits = options.filter((o) => o.name.toLowerCase().includes(p));
  return [...hits.filter((o) => o.name.toLowerCase().startsWith(p)), ...hits.filter((o) => !o.name.toLowerCase().startsWith(p))];
}

/** An unfinished `{{name` ending at the caret: where the `{{` starts and the name typed so far. */
export interface VariableQuery {
  from: number;
  partial: string;
}

const OPEN_REF = /\{\{\s*(\$?[\w.-]*)$/;

/** The `{{partial` right before `caret` in `text`, or null. */
export function variableQueryAt(text: string, caret: number): VariableQuery | null {
  const m = OPEN_REF.exec(text.slice(0, caret));
  return m ? { from: m.index, partial: m[1]! } : null;
}

/** `text` with the `{{partial` before `caret` (and the rest of the name and a `}}` after it) replaced by `{{name}}`; the caret goes after it. */
export function insertVariable(text: string, caret: number, name: string): { text: string; caret: number } {
  const q = variableQueryAt(text, caret);
  const from = q ? q.from : caret;
  const tail = /^[\w.-]*(\s*\}\})?/.exec(text.slice(caret))![0];
  const ref = `{{${name}}}`;
  return { text: text.slice(0, from) + ref + text.slice(caret + tail.length), caret: from + ref.length };
}

/** What completing `name` inserts when `after` follows the completed range: `name}}`, or only `name` when `}}` is already there. */
export function variableCompletionText(name: string, after: string): string {
  return /^\s*\}\}/.test(after) ? name : `${name}}}`;
}

/** Completes `{{name` in a CodeMirror editor with the variables and built-ins. */
export function variableCompletion(vars: readonly RestEnvVar[]): CompletionSource {
  const options: Completion[] = variableOptions(vars).map(({ name, detail }) => ({
    label: name,
    detail,
    type: 'variable',
    apply: (view, _c, from, to) => {
      const after = view.state.sliceDoc(to, to + 40);
      const insert = variableCompletionText(name, after);
      const skip = insert === name ? (/^\s*\}\}/.exec(after)![0].length) : 0;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + skip }, userEvent: 'input.complete' });
    },
  }));
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\{\{\s*\$?[\w.-]*$/);
    if (!m) return null;
    const q = variableQueryAt(m.text, m.text.length)!;
    return { from: m.to - q.partial.length, options, validFor: /^\$?[\w.-]*$/ };
  };
}

/** `variableCompletion` as language data, so it adds to the language's own completions. */
export function variableAutocomplete(vars: readonly RestEnvVar[]): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: variableCompletion(vars) }]);
}
