const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });

/** The feed URLs (`xmlUrl` of each outline) of an OPML document, http(s) only, no duplicates. */
export function opmlUrls(xml: string): string[] {
  const urls: string[] = [];
  for (const tag of xml.match(/<outline\b[^>]*>/gi) ?? []) {
    const m = /\sxmlUrl\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const url = decode((m?.[1] ?? m?.[2] ?? '').trim());
    if (/^https?:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
