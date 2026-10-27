// Builds ATOM_PATHS (+ per-extension file variants) in packages/ui/src/icons.ts from the Atom pack (coloured, mixed viewBoxes).
// Usage: bun scripts/build-atom-icons.ts
// Reads packages/ui/src/assets/icons/atom; mapping.json beside the svgs holds `icons` (IconName -> svg) and
// `variants` (`<icon>:<ext>` -> files/... svg). ui/ and outline/ glyphs get currentColor; files/ and folders/ keep
// their colours. Every icon is wrapped in a <g> that maps its viewBox onto 0 0 24 24 (scaled to fit, centred).
// Names without an Atom file keep the original stroke path.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, type IconName } from '../packages/ui/src/icons';

const assets = join(import.meta.dir, '../packages/ui/src/assets/icons/atom');
const mapping = JSON.parse(readFileSync(join(assets, 'mapping.json'), 'utf8')) as { icons: Record<string, string>; variants: Record<string, string> };
const files = new Map(Object.entries(mapping.icons));
const iconsFile = join(import.meta.dir, '../packages/ui/src/icons.ts');

const num = (n: number) => String(Math.round(n * 1e5) / 1e5);

function convert(name: string, rel: string): string {
  const svg = readFileSync(join(assets, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*>/g, '');
  const open = /<svg\b([^>]*)>/.exec(svg)!;
  const attrs = open[1]!;
  let inner = svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>'));
  const vb = (/viewBox="([^"]+)"/.exec(attrs)?.[1] ?? '0 0 24 24').trim().split(/[\s,]+/).map(Number);
  const [x, y, w, h] = vb as [number, number, number, number];
  const s = 24 / Math.max(w, h);
  const dx = (24 - w * s) / 2 - x * s;
  const dy = (24 - h * s) / 2 - y * s;
  const keep = ['fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-linejoin', 'stroke-linecap', 'stroke-miterlimit', 'stroke-width', 'opacity'];
  let groupAttrs = keep.map((a) => new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)).map((m, i) => (m ? ` ${keep[i]}="${m[1]}"` : '')).join('');
  const mono = rel.startsWith('ui/') || rel.startsWith('outline/');
  if (mono) {
    const recolour = (t: string) => t.replace(/(fill|stroke)="(?!none|url)[^"]*"/g, '$1="currentColor"');
    groupAttrs = recolour(groupAttrs);
    inner = recolour(inner);
  }
  const prefix = `atom-${name}-`;
  inner = inner
    .replace(/\sid="([^"]+)"/g, ` id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`)
    .replace(/\s+data-[\w-]+="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  return `<g transform="translate(${num(dx)} ${num(dy)}) scale(${num(s)})"${groupAttrs}>${inner}</g>`;
}

const fallback = (d: string) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

const out: string[] = [];
const missing: string[] = [];
for (const name of Object.keys(PATHS) as IconName[]) {
  const rel = files.get(name);
  if (!rel) missing.push(name);
  const markup = rel ? convert(name, rel) : fallback(PATHS[name]);
  out.push(`  ${JSON.stringify(name)}: ${JSON.stringify(markup)},${rel ? ` // ${rel}` : ' // original'}`);
}

// Per-extension file icons keyed `<icon>:<ext>` (what fileIconOf returns under this set). Each file is emitted once and shared.
const markupByFile = new Map<string, string>();
const variants: string[] = [];
for (const [key, rel] of Object.entries(mapping.variants)) {
  if (!(key.slice(0, key.indexOf(':')) in PATHS)) continue;
  if (!markupByFile.has(rel)) markupByFile.set(rel, convert(rel.replace(/\W+/g, '-'), rel));
  variants.push(`  ${JSON.stringify(key)}: ${JSON.stringify(rel)},`);
}
const fileEntries = [...markupByFile].map(([rel, markup]) => `  ${JSON.stringify(rel)}: ${JSON.stringify(markup)},`);

const block = `// atom:begin\nconst ATOM_PATHS: Record<IconName, string> = {\n${out.join('\n')}\n};\n` +
  `const ATOM_FILE_MARKUP: Record<string, string> = {\n${fileEntries.join('\n')}\n};\n` +
  `/** Per-extension file icons, keyed \`<icon>:<ext>\` (see setFileIconVariants in file-icons.ts). */\n` +
  `const ATOM_FILE_VARIANTS: Record<string, string> = Object.fromEntries(Object.entries({\n${variants.join('\n')}\n}).map(([k, f]) => [k, ATOM_FILE_MARKUP[f]!]));\n// atom:end`;
const src = readFileSync(iconsFile, 'utf8');
writeFileSync(iconsFile, src.replace(/\/\/ atom:begin[\s\S]*?\/\/ atom:end/, () => block));
console.log(`atom: ${out.length - missing.length} Atom icons, original fallback: ${missing.join(', ') || 'none'}; ${variants.length} file variants from ${markupByFile.size} files`);
