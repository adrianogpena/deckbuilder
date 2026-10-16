// Builds MATERIAL_PATHS in packages/ui/src/icons.ts from the Material Icons copy in packages/ui/src/assets/icons/material.
// Usage: bun scripts/build-material-icons.ts
// mapping.json (beside the svgs) maps each IconName to its svg file; the first non-transparent path/polygon is the glyph.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, type IconName } from '../packages/ui/src/icons';

const dir = join(import.meta.dir, '../packages/ui/src/assets/icons/material');
const mapping = JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')) as Record<string, string>;
const iconsFile = join(import.meta.dir, '../packages/ui/src/icons.ts');

function pathOf(file: string): string {
  const svg = readFileSync(join(dir, file), 'utf8');
  const ds: string[] = [];
  for (const m of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    if (/fill="none"/.test(m[1]!)) continue;
    const d = /\sd="([^"]+)"/.exec(m[1]!);
    if (d) ds.push(d[1]!);
  }
  for (const m of svg.matchAll(/<polygon\b[^>]*\spoints="([^"]+)"/g)) {
    const pts = m[1]!.trim().split(/[\s,]+/);
    const pairs: string[] = [];
    for (let i = 0; i < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`);
    ds.push(`M${pairs.join('L')}z`);
  }
  if (!ds.length) throw new Error(`no glyph in ${file}`);
  return ds.join(' ');
}

const out: string[] = [];
const missing: string[] = [];
for (const name of Object.keys(PATHS) as IconName[]) {
  const file = mapping[name];
  if (!file) { missing.push(name); continue; }
  out.push(`  ${JSON.stringify(name)}: ${JSON.stringify(pathOf(file))}, // ${file.replace(/\.svg$/, '')}`);
}
if (missing.length) throw new Error(`mapping.json lacks: ${missing.join(', ')}`);

const block = `// material:begin\nconst MATERIAL_PATHS: Record<IconName, string> = {\n${out.join('\n')}\n};\n// material:end`;
const src = readFileSync(iconsFile, 'utf8');
writeFileSync(iconsFile, src.replace(/\/\/ material:begin[\s\S]*?\/\/ material:end/, () => block));
console.log(`material: ${out.length} icons`);
