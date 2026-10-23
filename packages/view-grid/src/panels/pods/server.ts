import { AppError } from '@deckbuilderkit/server-core';
import { runCli } from '../../cli';
import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { PODS_FIELDS } from './fields';
import { DNS_1123, ingressUrls, mapPods, parseClusters, podConfigMaps, type Cluster, type Pod } from './model';

interface PodsConfig {
  clusters: string;
  refreshSec: number;
  showHealthy: boolean;
  [key: string]: unknown;
}

export interface PodsData {
  clusters: { context: string; namespace: string; error?: string }[];
  pods: Pod[];
}

const TIMEOUT_MS = 30_000;

let latest: Pod[] = [];

/** The pods of the last fetch (kept in memory only, never written to disk). */
export const latestPods = (): Pod[] => latest;

const kubectl = (c: { context: string; namespace: string }, args: string[], signal?: AbortSignal) =>
  runCli(['kubectl', '--context', c.context, '-n', c.namespace, ...args], { timeoutMs: TIMEOUT_MS, signal });

async function json(c: Cluster, args: string[], signal?: AbortSignal): Promise<unknown> {
  const r = await kubectl(c, [...args, '-o', 'json'], signal);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `kubectl exited with ${r.code}`);
  return JSON.parse(r.stdout);
}

async function fetchCluster(c: Cluster, signal: AbortSignal): Promise<Pod[]> {
  const pods = mapPods(await json(c, ['get', 'pods'], signal), c);
  if (pods.length === 0) return pods;
  try {
    const ingress = await json(c, ['get', 'ingress'], signal);
    for (const p of pods) p.urls = ingressUrls(ingress, p.labels, p.name);
  } catch (err) {
    if (err instanceof AppError || signal.aborted) throw err;
  }
  return pods;
}

function pick(config: PodsConfig, payload: unknown): { cluster: Cluster; pod: string } {
  const p = (payload ?? {}) as { context?: unknown; namespace?: unknown; pod?: unknown };
  const cluster = parseClusters(config.clusters).find((c) => c.context === p.context && c.namespace === p.namespace);
  if (!cluster) throw SourceError('not-configured', 'The cluster is not in the panel settings.');
  if (typeof p.pod !== 'string' || !DNS_1123.test(p.pod)) throw SourceError('upstream', 'Invalid pod name.');
  return { cluster, pod: p.pod };
}

async function text(c: Cluster, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await kubectl(c, args, signal);
  if (r.code !== 0) throw SourceError('upstream', 'kubectl failed.', r.stderr.trim() || r.stdout.trim());
  return r.stdout;
}

export const podsSource = defineSource<PodsConfig>({
  id: 'pods',
  fields: PODS_FIELDS,
  async fetch(config, ctx) {
    const out: PodsData = { clusters: [], pods: [] };
    const results = await Promise.all(
      parseClusters(config.clusters).map(async (c) => {
        try {
          return { c, pods: await fetchCluster(c, ctx.signal), error: undefined };
        } catch (err) {
          if (ctx.signal.aborted || (err instanceof AppError && err.code === 'source-tool-missing')) throw err;
          return { c, pods: [] as Pod[], error: String((err as Error)?.message ?? err).slice(0, 500) };
        }
      }),
    );
    for (const r of results) {
      out.clusters.push({ context: r.c.context, namespace: r.c.namespace, ...(r.error ? { error: r.error } : {}) });
      out.pods.push(...r.pods);
    }
    latest = out.pods;
    return out;
  },
  actions: {
    async restart(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      await text(cluster, ['delete', 'pod', pod], ctx.signal);
      return null;
    },
    async describe(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      const parts = [await text(cluster, ['describe', 'pod', pod], ctx.signal)];
      let urls: string[] = [];
      let maps: string[] = [];
      try {
        const podJson = (await json(cluster, ['get', 'pod', pod], ctx.signal)) as { metadata?: { labels?: Record<string, string> } };
        maps = podConfigMaps(podJson);
        urls = ingressUrls(await json(cluster, ['get', 'ingress'], ctx.signal), podJson.metadata?.labels ?? {}, pod);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
      }
      if (urls.length) parts.push(`\n===== Ingress =====\n${urls.join('\n')}\n`);
      for (const name of maps) {
        try {
          parts.push(`\n===== ConfigMap ${name} =====\n${await text(cluster, ['describe', 'configmap', name], ctx.signal)}`);
        } catch {
          parts.push(`\n===== ConfigMap ${name} =====\n(unavailable)\n`);
        }
      }
      return parts.join('\n');
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'pods', fields: PODS_FIELDS, allowMultiple: true }];

export const sources: DataSource<any>[] = [podsSource];
