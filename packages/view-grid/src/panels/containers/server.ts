import { runCli } from '../../cli';
import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { CONTAINERS_FIELDS } from './fields';
import { isMachineDown, parseDocker, parsePinned, parsePodman, sortPinned, type Container } from './model';

interface ContainersConfig {
  engine: string;
  pinned: string;
  showStopped: boolean;
  [key: string]: unknown;
}

export interface ContainersData {
  machineDown: boolean;
  containers: Container[];
}

const engineOf = (config: ContainersConfig): 'podman' | 'docker' => (config.engine === 'docker' ? 'docker' : 'podman');

async function list(config: ContainersConfig, signal?: AbortSignal): Promise<ContainersData> {
  const engine = engineOf(config);
  const argv = engine === 'docker' ? ['docker', 'ps', '-a', '--format', '{{json .}}'] : ['podman', 'ps', '-a', '--format', 'json'];
  const r = await runCli(argv, { timeoutMs: 30_000, signal });
  if (r.code !== 0) {
    if (engine === 'podman' && isMachineDown(r.stderr)) return { machineDown: true, containers: [] };
    throw SourceError('upstream', `${engine} failed.`, r.stderr.trim() || `exit ${r.code}`);
  }
  const all = engine === 'docker' ? parseDocker(r.stdout) : parsePodman(r.stdout);
  return { machineDown: false, containers: sortPinned(all, parsePinned(config.pinned ?? '')) };
}

async function control(verb: 'start' | 'stop', payload: unknown, config: ContainersConfig, signal: AbortSignal): Promise<null> {
  const name = (payload as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || !name) throw SourceError('upstream', 'Invalid container name.');
  const current = await list(config, signal);
  if (!current.containers.some((c) => c.name === name)) throw SourceError('upstream', 'Unknown container.');
  const r = await runCli([engineOf(config), verb, name], { timeoutMs: 30_000, signal });
  if (r.code !== 0) throw SourceError('upstream', `${engineOf(config)} ${verb} failed.`, r.stderr.trim() || `exit ${r.code}`);
  return null;
}

export const containersSource = defineSource<ContainersConfig>({
  id: 'containers',
  fields: CONTAINERS_FIELDS,
  fetch: (config, ctx) => list(config, ctx.signal),
  actions: {
    start: (payload, config, ctx) => control('start', payload, config, ctx.signal),
    stop: (payload, config, ctx) => control('stop', payload, config, ctx.signal),
    async 'machine-start'(_payload, config, ctx) {
      if (engineOf(config) !== 'podman') throw SourceError('upstream', 'Only Podman has a machine.');
      const r = await runCli(['podman', 'machine', 'start'], { timeoutMs: 120_000, signal: ctx.signal });
      if (r.code !== 0) throw SourceError('upstream', 'podman machine start failed.', r.stderr.trim() || `exit ${r.code}`);
      return null;
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'containers', fields: CONTAINERS_FIELDS, allowMultiple: true }];

export const sources: DataSource<any>[] = [containersSource];
