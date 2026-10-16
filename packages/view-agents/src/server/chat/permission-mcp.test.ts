import { expect, test } from 'bun:test';
import { handleMcpHttp, handleMcpMessage, type PermissionVerdict, permissionMcpConfig } from './permission-mcp.ts';

const allow = async (a: { input: unknown }): Promise<PermissionVerdict> => ({ behavior: 'allow', updatedInput: a.input });
const call = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'approve', arguments: { tool_name: 'Write', input: { file_path: 'a.txt' }, tool_use_id: 'tu1' } },
});

test('initialize, tools/list and notifications', async () => {
  expect(await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, allow)).toMatchObject({
    result: { protocolVersion: '2025-06-18', serverInfo: { name: 'perm' } },
  });
  expect(await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, allow)).toMatchObject({ result: { tools: [{ name: 'approve' }] } });
  expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, allow)).toBeUndefined();
  expect(await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, allow)).toMatchObject({ error: { code: -32601 } });
});

test('tools/call hands the request to ask and returns its verdict as JSON text', async () => {
  const seen: unknown[] = [];
  const reply = (await handleMcpMessage(call(4), async (a) => {
    seen.push(a);
    return { behavior: 'deny', message: 'no' };
  })) as { result: { content: Array<{ text: string }> } };
  expect(seen).toEqual([{ toolName: 'Write', input: { file_path: 'a.txt' }, toolUseId: 'tu1' }]);
  expect(JSON.parse(reply.result.content[0]!.text)).toEqual({ behavior: 'deny', message: 'no' });
});

test('over HTTP a call streams SSE with keepalives while the user decides', async () => {
  let answer!: (v: PermissionVerdict) => void;
  const res = await handleMcpHttp(call(5), () => new Promise<PermissionVerdict>((r) => (answer = r)), 10);
  expect(res.headers.get('content-type')).toBe('text/event-stream');
  const pending = res.text();
  await Bun.sleep(40);
  answer({ behavior: 'allow', updatedInput: { file_path: 'a.txt' } });
  const body = await pending;
  expect(body).toContain(': keepalive');
  const data = JSON.parse(body.split('data: ')[1]!.trim());
  expect(JSON.parse(data.result.content[0].text)).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.txt' } });
});

test('over HTTP other methods are plain JSON, notifications are 202', async () => {
  const list = await handleMcpHttp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, allow);
  expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(1);
  expect((await handleMcpHttp({ jsonrpc: '2.0', method: 'notifications/initialized' }, allow)).status).toBe(202);
});

test('config points the perm server at the url', () => {
  expect(JSON.parse(permissionMcpConfig('http://127.0.0.1:1/x'))).toEqual({ mcpServers: { perm: { type: 'http', url: 'http://127.0.0.1:1/x' } } });
});
