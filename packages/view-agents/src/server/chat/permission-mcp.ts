/**
 * The MCP server behind `--permission-prompt-tool`, spoken over MCP's streamable HTTP transport and served by the
 * deckbuilder server itself (`POST /api/agents/chat-mcp/<per-chat token>`, outside the session token check; the
 * path token is the credential). No child process: a stdio server would have to be launched as `bun <file>`, and in
 * the single exe there is no bun and no loose file. The CLI reaches it through `--mcp-config` (`type: "http"`).
 */

export const PERM_SERVER_NAME = 'perm';
export const PERM_TOOL_NAME = `mcp__${PERM_SERVER_NAME}__approve`;
export const CHAT_MCP_PATH = '/api/agents/chat-mcp/';

export interface PermissionAsk {
  toolName: string;
  input: unknown;
  toolUseId?: string;
}

/** What the CLI expects back as the tool's text content, JSON-encoded. */
export type PermissionVerdict = { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string };

export type AskFn = (ask: PermissionAsk) => Promise<PermissionVerdict>;

export function permissionMcpConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [PERM_SERVER_NAME]: { type: 'http', url } } });
}

const TOOL = {
  name: 'approve',
  description: 'Permission prompt handler',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One JSON-RPC message in, the reply out (undefined for notifications). */
export async function handleMcpMessage(msg: any, ask: AskFn): Promise<object | undefined> {
  if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') return fail(msg?.id ?? null, -32600, 'invalid request');
  if (msg.id === undefined) return undefined;
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: PERM_SERVER_NAME, version: '0.0.1' },
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: [TOOL] });
    case 'tools/call': {
      const a = msg.params?.arguments;
      if (msg.params?.name !== TOOL.name || typeof a?.tool_name !== 'string') return fail(msg.id, -32602, 'unknown tool');
      const verdict = await ask({ toolName: a.tool_name, input: a.input ?? {}, toolUseId: typeof a.tool_use_id === 'string' ? a.tool_use_id : undefined });
      return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(verdict) }] });
    }
    default:
      return fail(msg.id, -32601, 'no such method');
  }
}

const KEEPALIVE_MS = 4000;

/**
 * HTTP side of one POST. A `tools/call` waits for the user, and Bun drops a request that stays silent for 10 s, so
 * its reply streams as SSE with a comment line every few seconds until the answer; everything else is plain JSON.
 */
export async function handleMcpHttp(body: unknown, ask: AskFn, keepaliveMs = KEEPALIVE_MS): Promise<Response> {
  const isCall = typeof body === 'object' && body !== null && (body as { method?: unknown }).method === 'tools/call';
  if (!isCall) {
    const reply = await handleMcpMessage(body, ask);
    return reply === undefined ? new Response(null, { status: 202 }) : Response.json(reply);
  }
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => controller.enqueue(enc.encode(': keepalive\n\n')), keepaliveMs);
      handleMcpMessage(body, ask).then(
        (reply) => {
          clearInterval(timer);
          controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(reply)}\n\n`));
          controller.close();
        },
        (err) => {
          clearInterval(timer);
          controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(fail((body as any).id, -32603, String(err?.message ?? err)))}\n\n`));
          controller.close();
        },
      );
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
}
