import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentsServerView } from './server.ts';

test('accounts, sessions and seen routes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-'));
  const folder = join(home, '.claude', 'projects', 'C--proj');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 's1.jsonl'),
    JSON.stringify({ type: 'user', cwd: 'C:\\proj', message: { role: 'user', content: 'hello' } }) + '\n',
  );
  const view = agentsServerView({ home });
  const routes = view.routes({
    dataDir: join(home, 'data'),
    settings: { load: async () => ({}) },
    stores: { projects: { list: async () => [{ name: 'P', path: 'C:\\proj' }] } },
  });
  const accounts = (await routes['GET /api/agents/accounts']!({} as never)) as unknown[];
  expect(accounts).toHaveLength(1);
  const sessions = (await routes['GET /api/agents/sessions']!({} as never)) as Array<{ id: string; status: string }>;
  expect(sessions.map((s) => s.id)).toEqual(['s1']);
  expect(sessions[0]!.status).toBe('stopped');
  const res = await routes['POST /api/agents/seen']!({ json: async () => ({ sessionId: 's1' }) } as never);
  expect(res).toEqual({ ok: true });
  await view.onQuit?.();
});
