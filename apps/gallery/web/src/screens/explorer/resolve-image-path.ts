/** Project path of an image `src` found in the markdown file `filePath`; null when it leaves the project. */
export function resolveImagePath(filePath: string, src: string): string | null {
  let raw = src.split('#')[0]!.split('?')[0]!;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!raw) return null;
  const parts: string[] = raw.startsWith('/') ? [] : filePath.split('/').slice(0, -1);
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}
