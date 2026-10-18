import { tryT } from '@deckbuilderkit/ui/i18n';
import type { Node } from '@milkdown/prose/model';
import { type EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { useEffect } from 'react';
import { fenceName } from './codeBlock';
import type { RichApi, RichFeature } from './commands';

/** The block `insertMermaid` adds. */
export const MERMAID_SAMPLE = 'graph TD; A-->B';

interface MermaidState { enabled: boolean; dark: boolean }
const key = new PluginKey<MermaidState>('md-mermaid');
const isDark = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

type Mermaid = typeof import('mermaid').default;
let loading: Promise<Mermaid> | null = null;
let initializedDark: boolean | null = null;
let seq = 0;
/** Results by theme and source, so redrawing an unchanged block does not flash. */
const rendered = new Map<string, { svg: string } | { error: string }>();

/** Renders one diagram; Mermaid loads on first use, from the app's own bundle. */
async function render(source: string, dark: boolean): Promise<{ svg: string } | { error: string }> {
  const cacheKey = `${dark}:${source}`;
  const hit = rendered.get(cacheKey);
  if (hit) return hit;
  loading ??= import('mermaid').then((m) => m.default);
  const mermaid = await loading;
  if (initializedDark !== dark) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
    initializedDark = dark;
  }
  const id = `md-mermaid-${++seq}`;
  let result: { svg: string } | { error: string };
  try {
    result = { svg: (await mermaid.render(id, source)).svg };
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
    document.getElementById(id)?.remove();
    document.getElementById('d' + id)?.remove();
  }
  if (rendered.size > 200) rendered.clear();
  rendered.set(cacheKey, result);
  return result;
}

function preview(source: string, dark: boolean) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const el = document.createElement('div');
    el.className = 'md-mermaid md-mermaid-pending';
    el.contentEditable = 'false';
    // Clicking the diagram puts the cursor in its source.
    el.addEventListener('mousedown', (e) => {
      const end = getPos();
      if (end === undefined) return;
      const block = view.state.doc.resolve(end).nodeBefore;
      if (!block) return;
      e.preventDefault();
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 1)).scrollIntoView());
      view.focus();
    });
    void render(source, dark).then((r) => {
      el.classList.remove('md-mermaid-pending');
      if ('svg' in r) {
        el.innerHTML = r.svg;
        return;
      }
      el.classList.add('md-mermaid-error');
      const title = document.createElement('div');
      title.className = 'md-mermaid-error-title';
      title.textContent = tryT('explorer.md.mermaidError') ?? 'Mermaid diagram error';
      const message = document.createElement('div');
      message.className = 'md-mermaid-error-message';
      message.textContent = r.error;
      const pre = document.createElement('pre');
      pre.textContent = source;
      el.replaceChildren(title, message, pre);
    });
    return el;
  };
}

/** Whether the selection sits inside the block at `pos`. */
const cursorInside = (state: EditorState, pos: number, node: Node) => state.selection.from >= pos && state.selection.to <= pos + node.nodeSize;

function decorations(state: EditorState): DecorationSet | null {
  const s = key.getState(state);
  if (!s?.enabled) return null;
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    if (fenceName(String(node.attrs.language ?? '')) !== 'mermaid' || !node.textContent.trim()) return false;
    const end = pos + node.nodeSize;
    if (!cursorInside(state, pos, node)) decos.push(Decoration.node(pos, end, { class: 'md-mermaid-folded' }));
    decos.push(Decoration.widget(end, preview(node.textContent, s.dark), { key: `mermaid:${s.dark}:${node.textContent}`, side: -1, ignoreSelection: true }));
    return false;
  });
  return DecorationSet.create(state.doc, decos);
}

const mermaidPlugin = $prose(() => new Plugin<MermaidState>({
  key,
  state: {
    init: () => ({ enabled: true, dark: isDark() }),
    apply: (tr, old) => {
      const next = tr.getMeta(key) as Partial<MermaidState> | undefined;
      return next ? { ...old, ...next } : old;
    },
  },
  props: { decorations },
}));

/** Keeps the plugin in step with `settings.mermaid` and the light/dark theme. */
function MermaidSync({ api }: { api: RichApi }) {
  const enabled = api.host.settings.mermaid;
  useEffect(() => {
    const { view } = api;
    const push = (next: Partial<MermaidState>) => view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false));
    push({ enabled, dark: isDark() });
    const observer = new MutationObserver(() => {
      const dark = isDark();
      if (key.getState(view.state)?.dark !== dark) push({ dark });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [api, enabled]);
  return null;
}

/** Inserts the sample diagram as a new block. */
function insertMermaid(api: RichApi): boolean {
  const { view } = api;
  const type = view.state.schema.nodes.code_block;
  if (!type) return false;
  const node = type.create({ language: 'mermaid' }, view.state.schema.text(MERMAID_SAMPLE));
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
  return true;
}

/** Mermaid diagram previews below ```mermaid blocks and the insert command. */
export const mermaidFeature: RichFeature = { plugins: [mermaidPlugin], handlers: { insertMermaid }, Overlay: MermaidSync };
