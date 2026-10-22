import { expect, test } from 'bun:test';

import { markdownStoredOf, validMarkdown } from './markdown';

test('validMarkdown accepts in-range values', () => {
  expect(validMarkdown({ defaultMode: 'source', readingWidth: 80, zoom: 120, mermaid: false })).toEqual({ defaultMode: 'source', readingWidth: 80, zoom: 120, mermaid: false });
  expect(validMarkdown({ readingWidth: 'full' })).toEqual({ readingWidth: 'full' });
  expect(validMarkdown({ readingWidth: '70%', lineNumbers: true })).toEqual({ readingWidth: '70%', lineNumbers: true });
});

test('validMarkdown rejects bad relative widths and flags', () => {
  expect(validMarkdown({ readingWidth: '49%' })).toBeNull();
  expect(validMarkdown({ readingWidth: '101%' })).toBeNull();
  expect(validMarkdown({ readingWidth: '70.5%' })).toBeNull();
  expect(validMarkdown({ readingWidth: '70' })).toBeNull();
  expect(validMarkdown({ headingLinks: 'yes' })).toBeNull();
});

test('validMarkdown rejects out-of-range and unknown values', () => {
  expect(validMarkdown({ defaultMode: 'live' })).toBeNull();
  expect(validMarkdown({ readingWidth: 39 })).toBeNull();
  expect(validMarkdown({ readingWidth: 121 })).toBeNull();
  expect(validMarkdown({ zoom: 45 })).toBeNull();
  expect(validMarkdown({ zoom: 205 })).toBeNull();
  expect(validMarkdown({ zoom: 125 })).toBeNull();
  expect(validMarkdown({ mermaid: 1 })).toBeNull();
  expect(validMarkdown({ other: 1 })).toBeNull();
});

test('markdownStoredOf falls back to defaults', () => {
  expect(markdownStoredOf(undefined)).toEqual({ defaultMode: 'rich', readingWidth: 'comfortable', zoom: 100, mermaid: true, headingLinks: true, lineNumbers: false, lineBreaks: true });
  expect(markdownStoredOf({ zoom: 999 }).zoom).toBe(100);
});
