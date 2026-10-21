import { describe, expect, test } from 'bun:test';
import { decodeEntities, feedUrls, mergeFeeds, parseFeed, stripHtml } from './rss';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Hacker &amp; News</title>
  <link>https://example.com</link>
  <item>
    <title><![CDATA[First <b>post</b>]]></title>
    <link>https://example.com/1</link>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello &amp; <a href="x">welcome</a></p><script>bad()</script>]]></description>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/2</link>
    <pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate>
    <description>&lt;p&gt;Escaped &amp;amp; html&lt;/p&gt;</description>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link href="https://atom.example/" rel="self"/>
  <entry>
    <title>Entry one</title>
    <link rel="self" href="https://atom.example/self"/>
    <link rel="alternate" href="https://atom.example/1?a=1&amp;b=2"/>
    <updated>2026-10-21T12:00:00Z</updated>
    <summary type="html">&lt;b&gt;Bold&lt;/b&gt; text</summary>
  </entry>
  <entry>
    <title>Entry two</title>
    <link href="https://atom.example/2"/>
    <published>2026-10-19T12:00:00Z</published>
    <content>Body two</content>
  </entry>
</feed>`;

describe('rss', () => {
  test('parses RSS 2.0 with CDATA and entities', () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe('Hacker & News');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({ title: 'First post', link: 'https://example.com/1', summary: 'Hello & welcome', source: 'Hacker & News' });
    expect(feed.items[0]!.date).toBe(Date.parse('2026-10-20T10:00:00Z'));
    expect(feed.items[1]!.summary).toBe('Escaped & html');
  });

  test('parses Atom with link href and rel alternate', () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe('Atom Blog');
    expect(feed.items[0]).toMatchObject({ title: 'Entry one', link: 'https://atom.example/1?a=1&b=2', summary: 'Bold text' });
    expect(feed.items[1]).toMatchObject({ link: 'https://atom.example/2', summary: 'Body two' });
  });

  test('merges sorted by date and caps', () => {
    const items = mergeFeeds([parseFeed(RSS), parseFeed(ATOM)], 3);
    expect(items.map((i) => i.title)).toEqual(['Entry one', 'Second', 'First post']);
  });

  test('garbage gives an empty feed', () => {
    expect(parseFeed('not xml at all', 'Fallback')).toEqual({ title: 'Fallback', items: [] });
  });

  test('strips html and decodes entities', () => {
    expect(stripHtml('<div>a<br>b &#38; &#x41;</div>')).toBe('a b & A');
    expect(decodeEntities('&unknown; &lt;')).toBe('&unknown; <');
  });

  test('feed urls: http only, unique, limited', () => {
    expect(feedUrls('https://a.com/x\n\nftp://b\nhttps://a.com/x\n  http://c.com  ')).toEqual(['https://a.com/x', 'http://c.com']);
    expect(feedUrls(Array.from({ length: 12 }, (_, i) => `https://a.com/${i}`).join('\n'))).toHaveLength(10);
  });
});
