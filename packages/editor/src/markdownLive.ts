import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { highlightTree } from '@lezer/highlight';
import { langOfFile, parserOf } from './languages';
import { imagePolicy, renderMarkdown } from './markdown';
import { highlightStyle } from './theme';

const hidden = Decoration.replace({});
const lineDeco = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });

const HEADING = /^ATXHeading([1-6])$/;
const HIDDEN_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'QuoteMark', 'LinkMark', 'URL']);
const IMAGE = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)/;

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number) {
    super();
  }
  override eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from;
  }
  override toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'markdown cm-md-table';
    el.innerHTML = renderMarkdown(this.source);
    // Clicking the rendered table puts the cursor in it, which shows its source.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return el;
  }
  override ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly alt: string, readonly src: string) {
    super();
  }
  override eq(other: ImageWidget) {
    return other.alt === this.alt && other.src === this.src;
  }
  override toDOM() {
    if (this.src === 'blocked') {
      const span = document.createElement('span');
      span.className = 'cm-md-code';
      span.textContent = this.alt || 'image';
      return span;
    }
    const img = document.createElement('img');
    img.className = 'cm-md-img';
    img.src = this.src;
    img.alt = this.alt;
    return img;
  }
}

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  override toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    return span;
  }
}

class FenceLabel extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: FenceLabel) {
    return other.text === this.text;
  }
  override toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-fence-label';
    span.textContent = this.text;
    return span;
  }
}

/** Does any selection range touch a line of the span `from..to`? */
function touched(state: EditorState, from: number, to: number): boolean {
  const first = state.doc.lineAt(from).from;
  const last = state.doc.lineAt(to).to;
  return state.selection.ranges.some((r) => r.to >= first && r.from <= last);
}

function decorate(state: EditorState, resolveImage?: (src: string) => string | null): DecorationSet {
  const out: Range<Decoration>[] = [];
  const lined = new Set<string>();
  const addLine = (pos: number, cls: string) => {
    const from = state.doc.lineAt(pos).from;
    if (lined.has(`${from}:${cls}`)) return;
    lined.add(`${from}:${cls}`);
    out.push(lineDeco(cls).range(from));
  };
  const addLines = (from: number, to: number, cls: string) => {
    for (let p = from; p <= to;) {
      const l = state.doc.lineAt(p);
      addLine(l.from, cls);
      p = l.to + 1;
    }
  };

  const fenced = (code: SyntaxNode) => {
    const first = state.doc.lineAt(code.from);
    const last = state.doc.lineAt(code.to);
    const marks = code.getChildren('CodeMark');
    const closed = marks.length > 1 && marks[marks.length - 1].from >= first.to;
    const raw = touched(state, code.from, code.to);
    addLines(code.from, code.to, 'cm-md-fence');
    addLine(code.from, 'cm-md-fence-edge');
    if (closed) addLine(last.from, 'cm-md-fence-edge');
    const info = code.getChild('CodeInfo');
    const lang = info ? state.doc.sliceString(info.from, info.to).trim() : '';
    if (!raw) {
      if (first.to > first.from) out.push(Decoration.replace({ widget: new FenceLabel(lang) }).range(first.from, first.to));
      if (closed && last.to > last.from) out.push(hidden.range(last.from, last.to));
    }
    const body = code.getChild('CodeText');
    const parser = lang ? parserOf(lang.toLowerCase() === 'shell' ? 'shell' : langOfFile('x.' + lang.toLowerCase())) : null;
    if (!body || !parser) return;
    const text = state.doc.sliceString(body.from, body.to);
    highlightTree(parser.parse(text), highlightStyle, (from, to, classes) => {
      out.push(mark(classes).range(body.from + from, body.from + to));
    });
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      const heading = HEADING.exec(name);
      if (heading) {
        addLine(node.from, `cm-md-h cm-md-h${heading[1]}`);
        return;
      }
      switch (name) {
        case 'Table': {
          if (touched(state, node.from, node.to)) {
            addLines(node.from, node.to, 'cm-md-fence');
            return false;
          }
          const source = state.doc.sliceString(node.from, node.to);
          out.push(Decoration.replace({ widget: new TableWidget(source, node.from), block: true }).range(node.from, node.to));
          return false;
        }
        case 'Image': {
          if (touched(state, node.from, node.to)) return false;
          const m = IMAGE.exec(state.doc.sliceString(node.from, node.to));
          if (!m) return false;
          out.push(Decoration.replace({ widget: new ImageWidget(m[1], imagePolicy(m[2], resolveImage)) }).range(node.from, node.to));
          return false;
        }
        case 'StrongEmphasis': out.push(mark('cm-md-strong').range(node.from, node.to)); return;
        case 'Emphasis': out.push(mark('cm-md-em').range(node.from, node.to)); return;
        case 'Strikethrough': out.push(mark('cm-md-strike').range(node.from, node.to)); return;
        case 'InlineCode': out.push(mark('cm-md-code').range(node.from, node.to)); return;
        case 'Link': out.push(mark('cm-md-link').range(node.from, node.to)); return;
        case 'Blockquote': addLines(node.from, node.to, 'cm-md-quote'); return;
        case 'HorizontalRule': addLine(node.from, 'cm-md-hr'); return;
        case 'FencedCode': {
          fenced(node.node);
          return false;
        }
        case 'ListMark': {
          const list = node.node.parent?.parent;
          const text = state.doc.sliceString(node.from, node.to);
          if (list?.name === 'BulletList' && /^[-*+]$/.test(text) && !touched(state, node.from, node.to)) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }
        case 'TaskMarker': out.push(mark('cm-md-code').range(node.from, node.to)); return;
      }
      if (!HIDDEN_MARKS.has(name) || node.from === node.to) return;
      const parent = node.node.parent;
      if (!parent || parent.name === 'FencedCode' || parent.name === 'CodeBlock') return;
      if (name === 'URL' && parent.name !== 'Link') return;
      if (touched(state, parent.from, parent.to)) return;
      // A heading or quote mark takes its trailing space with it.
      const spaced = (name === 'HeaderMark' || name === 'QuoteMark') && state.doc.sliceString(node.to, node.to + 1) === ' ';
      out.push(hidden.range(node.from, spaced ? node.to + 1 : node.to));
    },
  });
  return Decoration.set(out, true);
}

// A state field, not a view plugin: block widgets (tables) can't come from a plugin.
const live = (resolveImage?: (src: string) => string | null) => StateField.define<DecorationSet>({
  create: (state) => decorate(state, resolveImage),
  update: (value, tr) =>
    tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? decorate(tr.state, resolveImage) : value,
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&.cm-editor .cm-scroller': { fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '14px', lineHeight: '1.7', padding: '8px 4px' },
  '.cm-content': { maxWidth: '860px', margin: '0 auto' },
  '.cm-md-h': { fontWeight: '600', lineHeight: '1.3' },
  '.cm-md-h1': { fontSize: '1.7em', paddingTop: '.5em' },
  '.cm-md-h2': { fontSize: '1.4em', paddingTop: '.4em' },
  '.cm-md-h3': { fontSize: '1.2em', paddingTop: '.3em' },
  '.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontSize: '1.05em', color: 'var(--text-2)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': { fontFamily: 'var(--font-mono)', fontSize: '.9em', backgroundColor: 'var(--bg-sunken)', borderRadius: '4px', padding: '0 3px' },
  '.cm-md-link': { color: 'var(--accent)' },
  '.cm-md-quote': { borderLeft: '3px solid var(--border)', paddingLeft: '10px', color: 'var(--text-2)' },
  '.cm-md-hr': { borderBottom: '1px solid var(--border)' },
  '.cm-md-fence': { fontFamily: 'var(--font-mono)', fontSize: '.9em', lineHeight: '1.5', backgroundColor: 'var(--bg-elev)', paddingLeft: '10px' },
  '.cm-md-fence-edge': { fontSize: '.75em', lineHeight: '1.6' },
  '.cm-md-fence-label': { color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' },
  '.cm-md-table': { padding: '4px 0', whiteSpace: 'normal', lineHeight: '1.5' },
  '.cm-md-img': { maxWidth: '100%', verticalAlign: 'middle' },
  '.cm-md-bullet': { color: 'var(--text-2)', padding: '0 2px' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
});

/** Live preview for markdown: formatted inline (tables and images as rendered widgets), raw syntax only where the cursor is. */
export const markdownLive = (resolveImage?: (src: string) => string | null): Extension => [live(resolveImage), theme];
