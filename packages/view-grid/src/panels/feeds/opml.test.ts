import { expect, test } from 'bun:test';
import { opmlUrls } from './opml';

test('opmlUrls reads nested outlines, decodes entities and drops duplicates and non-http', () => {
  const xml = `<opml version="2.0"><body>
    <outline text="News"><outline type="rss" xmlUrl="https://a.test/feed?x=1&amp;y=2"/>
    <outline type="rss" xmlUrl='https://b.test/rss'/></outline>
    <outline xmlUrl="https://a.test/feed?x=1&amp;y=2"/>
    <outline xmlUrl="ftp://c.test/rss"/><outline text="no url"/></body></opml>`;
  expect(opmlUrls(xml)).toEqual(['https://a.test/feed?x=1&y=2', 'https://b.test/rss']);
});
