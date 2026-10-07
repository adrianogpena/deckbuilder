// Deep links: `<scheme>://open/<path>` opens the app on `#<path>`.

/** A path that is safe to put after `#` in the UI address. */
export function isSafePath(path: string): boolean {
  return /^[A-Za-z0-9_\-./]*$/.test(path) && !path.includes('..');
}

/** The path of a `<scheme>://open/<path>` link, or null when it is not one or the path is unsafe. */
export function parseAppLink(uri: string, scheme: string): string | null {
  const prefix = `${scheme}://open`;
  if (uri.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return null;
  const rest = uri.slice(prefix.length);
  if (rest !== '' && !rest.startsWith('/')) return null;
  const path = rest.replace(/^\//, '').replace(/\/$/, '');
  return isSafePath(path) ? path : null;
}
