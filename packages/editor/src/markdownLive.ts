import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { highlightTree } from '@lezer/highlight';
import { langOfFile, parserOf } from './languages';
import { frontmatter, frontmatterEntries, frontmatterTable, imagePolicy, renderMarkdown } from './markdown';
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

class FrontmatterWidget extends WidgetType {
  constructor(readonly entries: [string, string][], readonly source: string) {
    super();
  }
  override eq(other: FrontmatterWidget) {
    return other.source === this.source;
  }
  override toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = 'markdown cm-md-table';
    el.append(frontmatterTable(this.entries));
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
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

  const fm = frontmatter(state.doc.toString());
  const fmEnd = fm?.length ?? 0;
  if (fm) {
    const last = state.doc.lineAt(Math.max(0, fmEnd - 1)).number;
    const entries = frontmatterEntries(fm.yaml);
    if (entries && !touched(state, 0, state.doc.line(last).to)) {
      const source = state.doc.sliceString(0, state.doc.line(last).to);
      out.push(Decoration.replace({ widget: new FrontmatterWidget(entries, source), block: true }).range(0, state.doc.line(last).to));
    } else {
      for (let n = 1; n <= last; n++) addLine(state.doc.line(n).from, n === 1 || n === last ? 'cm-md-fence cm-md-fence-edge' : 'cm-md-fence');
      const offset = state.doc.line(2).from;
      const parser = parserOf('yaml');
      if (parser) {
        highlightTree(parser.parse(state.doc.sliceString(offset, state.doc.line(last).from)), highlightStyle, (from, to, classes) => {
          out.push(mark(classes).range(offset + from, offset + to));
        });
      }
    }
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from < fmEnd && node.name !== 'Document') return false;
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
  // Mirrors `.markdown` in the UI styles, so Live reads like Preview.
  '&': { backgroundColor: 'var(--bg)', fontSize: '14px' },
  '&.cm-editor .cm-scroller': { fontFamily: "'Geist', 'Segoe UI', system-ui, sans-serif", fontSize: '14px', lineHeight: '1.6', padding: '4px 12px' },
  '.cm-content': { maxWidth: 'var(--md-width, 860px)', margin: 'var(--md-margin, 0 auto)', padding: '0' },
  '.cm-md-h span': { color: 'inherit' },
  '.cm-md-h': { fontWeight: '600', lineHeight: '1.25', letterSpacing: '-.01em' },
  '.cm-md-h1': { fontSize: '24px', paddingTop: '16px', paddingBottom: '6px', borderBottom: '1px solid var(--border-soft)', marginBottom: '8px' },
  '.cm-md-h2': { fontSize: '19px', paddingTop: '14px', paddingBottom: '4px', borderBottom: '1px solid var(--border-soft)', marginBottom: '8px' },
  '.cm-md-h3': { fontSize: '16px', paddingTop: '12px' },
  '.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontSize: '14px', paddingTop: '10px', color: 'var(--text-2)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', backgroundColor: 'var(--bg-sunken)', borderRadius: '4px', padding: '1px 5px' },
  '.cm-md-link, .cm-md-link span': { color: 'var(--accent)' },
  '.cm-md-quote': { borderLeft: '3px solid var(--border)', paddingLeft: '12px', color: 'var(--text-2)' },
  '.cm-md-quote span': { color: 'inherit' },
  '.cm-md-hr': { borderBottom: '1px solid var(--border)', paddingBottom: '9px', marginBottom: '9px' },
  '.cm-md-fence': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: '1.55', backgroundColor: 'var(--bg-sunken)', padding: '0 12px', borderLeft: '1px solid var(--border-soft)', borderRight: '1px solid var(--border-soft)' },
  '.cm-md-fence-edge': { padding: '5px 12px', lineHeight: '1.3', color: 'var(--text-3)' },
  '.cm-md-fence-label': { color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em' },
  '.cm-md-table': { padding: '4px 0', whiteSpace: 'normal', lineHeight: '1.5' },
  '.cm-md-img': { maxWidth: '100%', verticalAlign: 'middle' },
  '.cm-md-bullet': { color: 'var(--text-2)', padding: '0 2px' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
});

/** Live preview for markdown: formatted inline (tables and images as rendered widgets), raw syntax only where the cursor is. */
export const markdownLive = (resolveImage?: (src: string) => string | null): Extension => [live(resolveImage), theme];
