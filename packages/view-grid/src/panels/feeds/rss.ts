export interface FeedItem {
  title: string;
  link: string;
  /** Epoch ms; 0 when the item has no valid date. */
  date: number;
  summary: string;
  /** Title of the feed the item came from. */
  source: string;
}

export interface Feed {
  title: string;
  items: FeedItem[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the named and numeric character references. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML fragment: tags, scripts and styles dropped, entities decoded, spaces collapsed. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Text of an element's body: CDATA kept as is, otherwise entities decoded. */
const bodyText = (raw: string): string => {
  const cdata = CDATA.exec(raw);
  return cdata ? cdata[1]! : decodeEntities(raw);
};

/** The text of the first `<tag>` in `xml` (`''` when absent). */
export function tagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i');
  const m = re.exec(xml);
  return m ? bodyText(m[1]!).trim() : '';
}

const attr = (tagSource: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tagSource);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
};

/** The link of an entry: RSS `<link>text</link>`, or Atom `<link href>` preferring `rel="alternate"`. */
export function linkOf(xml: string): string {
  const atom: { href: string; rel: string }[] = [];
  const re = /<link\b([^>]*?)\/?>(?:([\s\S]*?)<\/link\s*>)?/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const href = attr(m[1]!, 'href');
    if (href) atom.push({ href, rel: attr(m[1]!, 'rel') });
    else if (m[2] && m[2].trim()) return bodyText(m[2]).trim();
  }
  return (atom.find((l) => !l.rel || l.rel === 'alternate') ?? atom[0])?.href ?? '';
}

const first = (xml: string, tags: readonly string[]): string => {
  for (const tag of tags) {
    const value = tagText(xml, tag);
    if (value) return value;
  }
  return '';
};

const BLOCK = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/** Parses RSS 2.0 (and RSS 1.0) and Atom; tolerant of missing parts, never throws. */
export function parseFeed(xml: string, fallbackTitle = ''): Feed {
  const blocks = [...xml.matchAll(BLOCK)].map((m) => m[2]!);
  const title = stripHtml(tagText(xml.replace(BLOCK, ''), 'title')) || fallbackTitle;
  const items = blocks.map((block): FeedItem => {
    const ms = Date.parse(first(block, ['pubDate', 'published', 'updated', 'dc:date']));
    return {
      title: stripHtml(tagText(block, 'title')) || stripHtml(linkOf(block)),
      link: linkOf(block),
      date: Number.isFinite(ms) ? ms : 0,
      summary: stripHtml(first(block, ['description', 'summary', 'content:encoded', 'content'])),
      source: title,
    };
  });
  return { title, items };
}

/** All items of `feeds`, newest first (undated last), at most `max`. */
export function mergeFeeds(feeds: readonly Feed[], max: number): FeedItem[] {
  return feeds
    .flatMap((f) => f.items)
    .sort((a, b) => b.date - a.date)
    .slice(0, max);
}

/** The feed URLs of a text field: one per line, http(s) only, no duplicates, at most `limit`. */
export function feedUrls(text: string, limit = 10): string[] {
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.trim();
    if (/^https?:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, limit);
}
