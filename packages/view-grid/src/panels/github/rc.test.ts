import { describe, expect, test } from 'bun:test';
import { isRcComment, latestRc, parseRcComment } from './rc';

const BODY = [
  '<!-- 01a1622b-edac-77da-9486-947c5752d977 -->',
  'We have generated the following RC versions for you:',
  '### miles-vwde-ubc',
  '|Build Date|Version| Maven | Native | Scratch | JVM | JVM JLink | DB scripts | Angular |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 2026-10-22T10:56:22Z |`1.1.0-rc-35-dipe.20261022104016`|✅|🚧|✅|🚧|🚧|🚧|[1.1.0-rc-35-dipe.20261022104016](https://github.com/orgs/sofico-codebase/packages/npm/package/miles.web.api.miles-vwde-ubc-v1)|',
  '| 2026-10-26T11:06:51+01:00 |`⚡ RC build failed`|❌|🚧|🚧|🚧|🚧|🚧|🚧|',
  '',
  '> [!WARNING]',
  '> Not allowed dependency versions',
  '> - foo 1.0',
].join('\n');

describe('parseRcComment', () => {
  const info = parseRcComment(BODY);

  test('recognises the marker', () => {
    expect(isRcComment(BODY)).toBe(true);
    expect(isRcComment('hello')).toBe(false);
  });

  test('parses modules and builds in order', () => {
    expect(info.modules).toHaveLength(1);
    const [a, b] = info.modules[0]!.builds;
    expect(a).toMatchObject({ version: '1.1.0-rc-35-dipe.20261022104016', failed: false, steps: { maven: 'ok', native: 'none', scratch: 'ok' } });
    expect(a!.npmUrl).toContain('miles-vwde-ubc-v1');
    expect(b).toMatchObject({ version: null, failed: true, steps: { maven: 'fail', angular: 'none' } });
  });

  test('keeps warnings', () => {
    expect(info.warnings).toEqual(['Not allowed dependency versions', '- foo 1.0']);
  });

  test('latest is the last row and last good is the older success', () => {
    const r = latestRc(info.modules);
    expect(r.latest?.failed).toBe(true);
    expect(r.lastGood).toBe('1.1.0-rc-35-dipe.20261022104016');
  });
});
