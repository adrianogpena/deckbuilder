import { describe, expect, test } from 'bun:test';
import { curlAt, curlCommands } from '../src/curl-file.ts';

describe('curlCommands', () => {
  test('finds two commands and skips comments and blank lines', () => {
    const text = '# first\ncurl https://a.test\n\n# second\n$ curl.exe https://b.test\n';
    const cmds = curlCommands(text);
    expect(cmds.map((c) => c.text)).toEqual(['curl https://a.test', '$ curl.exe https://b.test']);
    expect(text.slice(cmds[1]!.from, cmds[1]!.to)).toBe(cmds[1]!.text);
  });

  test('joins bash continuations', () => {
    const text = "curl https://a.test \\\n  -H 'x: y' \\\n  --compressed\ncurl https://b.test";
    const cmds = curlCommands(text);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]!.text).toBe("curl https://a.test \\\n  -H 'x: y' \\\n  --compressed");
  });

  test('joins cmd continuations', () => {
    const text = 'curl ^"https://a.test^" ^\r\n  -H ^"x: y^"\r\ncurl https://b.test';
    const cmds = curlCommands(text);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]!.text).toBe('curl ^"https://a.test^" ^\r\n  -H ^"x: y^"');
  });

  test('a quoted body with a line starting with curl does not start a command', () => {
    const text = "curl -d 'a\ncurl b\n' https://a.test\ncurl https://b.test";
    const cmds = curlCommands(text);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]!.text).toBe("curl -d 'a\ncurl b\n' https://a.test");
  });
});

describe('curlAt', () => {
  const text = 'curl https://a.test\n\n# note\n\ncurl https://b.test';

  test('returns the command containing the offset', () => {
    expect(curlAt(text, 3)?.text).toBe('curl https://a.test');
    expect(curlAt(text, text.length)?.text).toBe('curl https://b.test');
  });

  test('on a blank line returns the nearest command above', () => {
    expect(curlAt(text, 20)?.text).toBe('curl https://a.test');
  });

  test('returns null before the first command', () => {
    expect(curlAt('# x\ncurl https://a.test', 1)).toBeNull();
  });
});
