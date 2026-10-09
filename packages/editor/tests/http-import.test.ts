import { describe, expect, test } from 'bun:test';
import { parseCurl, parseHttpFile, parseImport } from '../src/http-import.ts';

const BASH = String.raw`curl 'https://api.example.com/items?x=1' \
  -H 'accept: application/json' \
  -H 'authorization: Bearer abc' \
  -H 'content-type: application/json' \
  --data-raw '{"name":"a b","n":1}' \
  --compressed`;

const CMD = String.raw`curl ^"https://api.example.com/items?x=1^" ^
  -H ^"accept: application/json^" ^
  -H ^"authorization: Bearer abc^" ^
  -H ^"content-type: application/json^" ^
  --data-raw ^"^{^\^"name^\^":^\^"a b^\^",^\^"n^\^":1^}^" ^
  --compressed`;

describe('parseCurl', () => {
  test('bash and cmd copies of the same request give equal drafts', () => {
    const bash = parseCurl(BASH);
    const cmd = parseCurl(CMD);
    expect(cmd).toEqual(bash);
    expect(bash.draft).toEqual({
      method: 'POST',
      url: 'https://api.example.com/items?x=1',
      headers: [
        { name: 'accept', value: 'application/json', enabled: true },
        { name: 'content-type', value: 'application/json', enabled: true },
      ],
      body: '{"name":"a b","n":1}',
      bodyLang: 'json',
    });
    expect(bash.auth).toBe('Bearer abc');
    expect(bash.warnings).toEqual([]);
  });

  test('reads $-quoted strings with escapes', () => {
    const { draft } = parseCurl(String.raw`curl 'http://x' -X PUT --data-raw $'{"t":"a\nb","c":"ç","q":"it\'s"}'`);
    expect(draft.method).toBe('PUT');
    expect(draft.body).toBe(`{"t":"a\nb","c":"ç","q":"it's"}`);
  });

  test('-u becomes a Basic authorization', () => {
    const { auth, draft } = parseCurl('curl -u user:pa55 http://x');
    expect(auth).toBe(`Basic ${btoa('user:pa55')}`);
    expect(draft.headers).toEqual([]);
    expect(draft.method).toBe('GET');
  });

  test('--data-urlencode encodes values and joins with &', () => {
    const { draft } = parseCurl('curl http://x -d a=1 --data-urlencode "q=a b&c" --data-urlencode "x y"');
    expect(draft.method).toBe('POST');
    expect(draft.body).toBe('a=1&q=a%20b%26c&x%20y');
    expect(draft.bodyLang).toBe('text');
  });

  test('-G moves data to the query string', () => {
    const { draft } = parseCurl('curl -G http://x/p?a=1 -d b=2 -d c=3');
    expect(draft.method).toBe('GET');
    expect(draft.url).toBe('http://x/p?a=1&b=2&c=3');
    expect(draft.body).toBe('');
  });

  test('maps -k, -L, -m and the header shortcuts', () => {
    const { draft } = parseCurl('curl -skL -m 500 -A agent -e http://ref -b "a=1" http://x');
    expect(draft.insecure).toBe(true);
    expect(draft.followRedirects).toBe(true);
    expect(draft.timeoutMs).toBe(300_000);
    expect(draft.headers.map((h) => h.name)).toEqual(['User-Agent', 'Referer', 'Cookie']);
  });

  test('--json sets the body and the JSON headers', () => {
    const { draft } = parseCurl(`curl http://x --json '{"a":1}'`);
    expect(draft.method).toBe('POST');
    expect(draft.headers.map((h) => h.name)).toEqual(['Content-Type', 'Accept']);
    expect(draft.bodyLang).toBe('json');
  });

  test('warns about unknown flags and data files', () => {
    const { warnings } = parseCurl('curl http://x --foo -d @body.json');
    expect(warnings).toEqual(['unknownFlag:--foo', 'dataFile:@body.json']);
  });

  test('throws notCurl for other text', () => {
    expect(() => parseCurl('GET http://x')).toThrow('notCurl');
    expect(() => parseCurl('')).toThrow('notCurl');
  });
});

const HTTP_FILE = `# Sample file
@host = https://api.example.com
@token = abc123

### List items
GET {{host}}/items
  ?page=1
  &size=20
Accept: application/json
// a comment between headers
Authorization: Bearer {{token}}

###
# @name create
POST {{host}}/items HTTP/1.1
Content-Type: application/json

{
  "name": "a",
  "tags": ["x", "y"]
}

### Ping {{missing}}
{{host}}/ping
`;

describe('parseHttpFile', () => {
  const requests = parseHttpFile(HTTP_FILE);

  test('splits requests and names them', () => {
    expect(requests.map((r) => r.name)).toEqual(['List items', 'create', 'Ping {{missing}}']);
    expect(requests.map((r) => r.draft.method)).toEqual(['GET', 'POST', 'GET']);
  });

  test('substitutes variables and joins continuation lines', () => {
    expect(requests[0].draft.url).toBe('https://api.example.com/items?page=1&size=20');
    expect(requests[2].draft.url).toBe('https://api.example.com/ping');
  });

  test('moves Authorization to auth and skips comments', () => {
    expect(requests[0].auth).toBe('Bearer abc123');
    expect(requests[0].draft.headers).toEqual([{ name: 'Accept', value: 'application/json', enabled: true }]);
  });

  test('keeps a multi-line JSON body', () => {
    expect(JSON.parse(requests[1].draft.body)).toEqual({ name: 'a', tags: ['x', 'y'] });
    expect(requests[1].draft.bodyLang).toBe('json');
  });

  test('warns about unresolved variables', () => {
    expect(requests[2].warnings).toEqual(['unresolvedVar:missing']);
  });

  test('warns about a body read from a file', () => {
    const [request] = parseHttpFile('POST http://x\nContent-Type: text/plain\n\n< ./body.txt\n');
    expect(request.draft.body).toBe('');
    expect(request.warnings).toEqual(['bodyFile:./body.txt']);
  });
});

describe('parseImport', () => {
  test('picks cURL or .http by the first word', () => {
    expect(parseImport('curl http://x')).toHaveLength(1);
    expect(parseImport('GET http://x\n\n###\nGET http://y')).toHaveLength(2);
  });
});
