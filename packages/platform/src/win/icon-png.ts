import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '@kedalion/ui/icons';

export const DEFAULT_ICON_COLOR = '#4f6bed';
const SIZE = 96;

export interface IconPngOptions {
  /** Icon name of the original set (`PATHS`). */
  name: string;
  /** Badge colour, `#rrggbb`. */
  color?: string;
  /** Cache folder; created when missing. */
  dir: string;
}

/** SVG of a rounded-square badge with the icon stroked in white (white alone is invisible on light toasts). */
export function iconBadgeSvg(path: string, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="20" fill="${color}"/>` +
    `<g transform="translate(${SIZE / 4} ${SIZE / 4}) scale(2)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path}"/></g></svg>`
  );
}

/**
 * Path of the PNG badge for an icon, rendered once with `sharp` and cached in `dir` by name and
 * colour. Undefined for an unknown name or when rendering fails (sharp missing, folder unwritable):
 * the toast then shows without a logo.
 */
export async function iconPng(opts: IconPngOptions): Promise<string | undefined> {
  const path = (PATHS as Record<string, string | undefined>)[opts.name];
  const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? opts.color! : DEFAULT_ICON_COLOR;
  if (!path) return undefined;
  const file = join(opts.dir, `${opts.name}-${color.slice(1).toLowerCase()}-${SIZE}.png`);
  if (existsSync(file)) return file;
  try {
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from(iconBadgeSvg(path, color)), { density: 144 }).resize(SIZE, SIZE).png().toBuffer();
    await mkdir(opts.dir, { recursive: true });
    await Bun.write(file, png);
    return file;
  } catch {
    return undefined;
  }
}
