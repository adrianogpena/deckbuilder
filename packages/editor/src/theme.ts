import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Only the CSS tokens from @deckbuilder/ui's styles.css, so every palette (and a palette switch
// while the editor is open) works with no per-palette code.

export const editorTheme = EditorView.theme({
  // Fills its host when the host has a height, else grows with the content.
  '&': { height: '100%', backgroundColor: 'var(--bg-sunken)', color: 'var(--text)', fontSize: 'var(--editor-font-size, 12.5px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: 'var(--editor-line-height, 1.55)' },
  '.cm-content': { caretColor: 'var(--accent)', fontVariantLigatures: 'var(--editor-ligatures, normal)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-elev)', color: 'var(--text-3)', borderRight: '1px solid var(--border-soft)' },
  // Translucent: the selection layer is drawn behind the lines, so an opaque one would hide it.
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--hover) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)', color: 'var(--text-2)' },
  '.cm-searchMatch': { backgroundColor: 'var(--mark)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--mark)', outline: '1px solid var(--warn)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--err-soft)' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': { fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'inherit' },
  '.cm-panel.cm-search input.cm-textfield': {
    backgroundColor: 'var(--bg-sunken)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px',
  },
  '.cm-panel.cm-search input.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)' },
  '.cm-panel.cm-search button.cm-button': {
    backgroundImage: 'none', backgroundColor: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px',
  },
  '.cm-panel.cm-search button.cm-button:hover': { backgroundColor: 'var(--hover)' },
  '.cm-panel.cm-search button.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--selected)' },
  '.cm-panel.cm-search label': { color: 'var(--text-2)' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
  '.cm-panel.cm-search button[name=close]': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-2)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selected)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-3)' },
  '.cm-completionMatchedText': { color: 'var(--accent)', textDecoration: 'none' },
});

export const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: 'var(--y-key)' },
  { tag: [tags.propertyName, tags.attributeName, tags.heading], color: 'var(--y-key)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.link, tags.url], color: 'var(--y-str)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--y-num)' },
  { tag: [tags.bool, tags.atom, tags.null, tags.constant(tags.name)], color: 'var(--y-bool)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--y-comment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--err)' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.heading, fontWeight: '600' },
]);

/** Theme + syntax colours, for every EditorView in this package. */
export const themeExtension = [editorTheme, syntaxHighlighting(highlightStyle)];
