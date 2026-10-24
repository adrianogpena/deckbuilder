import { AppError, ndjson } from '@deckbuilderkit/server-core';
import { runCli } from '../../cli';
import { parseTail, PodLogHub, validateTarget } from './logs';
import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { PODS_FIELDS } from './fields';
import { classifyStderr, type KubeError } from './kube-errors';
import { parseMetrics, sanitizePod, type PodUsage } from './detail';
import { DNS_1123, healthChanges, ingressUrls, mapPods, parseEntries, podConfigMaps, type Cluster, type Pod, type PodEntry, type PodsConfig as PodsSettings } from './model';

type PodsConfig = PodsSettings & { [key: string]: unknown };

export interface PodsData {
  clusters: { context: string; namespace: string; error?: KubeError }[];
  pods: Pod[];
}

const TIMEOUT_MS = 30_000;

const logHub = new PodLogHub();

let latest: Pod[] = [];

/** Pod health seen so far, shared by every panel instance so a change notifies once. */
const healthSeen = new Map<string, boolean>();

/** One cluster per distinct (context, namespace), with the pod texts of its entries. */
export function groupEntries(entries: readonly PodEntry[]): Cluster[] {
  const groups = new Map<string, Cluster>();
  for (const e of entries) {
    const key = `${e.context}\n${e.namespace}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { context: e.context, namespace: e.namespace, patterns: [] }));
    if (!g.patterns.includes(e.pod)) g.patterns.push(e.pod);
  }
  return [...groups.values()];
}

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

export function pick(config: { clusters: string }, payload: unknown): { cluster: Cluster; pod: string } {
  const p = (payload ?? {}) as { context?: unknown; namespace?: unknown; pod?: unknown };
  const cluster = groupEntries(parseEntries(config.clusters)).find((c) => c.context === p.context && c.namespace === p.namespace);
  if (!cluster) throw SourceError('not-configured', 'The cluster is not in the panel settings.');
  if (typeof p.pod !== 'string' || !DNS_1123.test(p.pod)) throw SourceError('upstream', 'Invalid pod name.');
  return { cluster, pod: p.pod };
}

async function text(c: Cluster, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await kubectl(c, args, signal);
  if (r.code !== 0) throw SourceError('upstream', 'kubectl failed.', r.stderr.trim() || r.stdout.trim());
  return r.stdout;
}

/** The contexts of a `kubectl config view -o json` output. */
export function readContexts(stdout: string): { contexts: { name: string; namespace?: string }[]; current?: string } {
  let cfg: { contexts?: { name?: unknown; context?: { namespace?: unknown } }[]; 'current-context'?: unknown };
  try {
    cfg = JSON.parse(stdout);
  } catch {
    return { contexts: [] };
  }
  const contexts = (cfg.contexts ?? []).flatMap((c) =>
    typeof c.name === 'string' ? [{ name: c.name, ...(typeof c.context?.namespace === 'string' && c.context.namespace ? { namespace: c.context.namespace } : {}) }] : [],
  );
  return { contexts, ...(typeof cfg['current-context'] === 'string' && cfg['current-context'] ? { current: cfg['current-context'] } : {}) };
}

export const podsSource =defineSource<PodsConfig>({
  id: 'pods',
  fields: PODS_FIELDS,
  async fetch(config, ctx) {
    const out: PodsData = { clusters: [], pods: [] };
    const results = await Promise.all(
      groupEntries(parseEntries(config.clusters)).map(async (c) => {
        try {
          return { c, pods: await fetchCluster(c, ctx.signal), error: undefined as KubeError | undefined };
        } catch (err) {
          if (ctx.signal.aborted || (err instanceof AppError && err.code === 'source-tool-missing')) throw err;
          return { c, pods: [] as Pod[], error: classifyStderr(String((err as Error)?.message ?? err)) as KubeError | undefined };
        }
      }),
    );
    for (const r of results) {
      out.clusters.push({ context: r.c.context, namespace: r.c.namespace, ...(r.error ? { error: r.error } : {}) });
      out.pods.push(...r.pods);
    }
    latest = out.pods;
    if (config.notifyHealth !== false && ctx.notify) {
      for (const { pod, healthy } of healthChanges(healthSeen, out.pods)) {
        ctx.notify({ title: healthy ? 'Pod recovered' : 'Pod unhealthy', body: `${pod.context}/${pod.namespace}/${pod.name}: ${pod.status}` }).catch(() => {});
      }
    }
    return out;
  },
  streams: {
    logs(query, ctx) {
      const target = validateTarget({ context: query.get('context'), namespace: query.get('namespace'), pod: query.get('pod') });
      if (!target) throw SourceError('upstream', 'Invalid pod, context or namespace.');
      const tail = parseTail(query.get('tail'));
      return ndjson(ctx.req, async (emit, signal) => {
        let chain: Promise<void> = Promise.resolve();
        let leave = () => {};
        const done = new Promise<void>((resolve) => {
          leave = logHub.subscribe(target, tail, (m) => {
            chain = chain.then(() => emit(m));
            if ('status' in m && m.status === 'ended') chain = chain.then(resolve);
          });
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        try {
          await done;
          await chain;
        } finally {
          leave();
        }
      });
    },
  },
  actions: {
    async contexts(_payload, _config, ctx) {
      const r = await runCli(['kubectl', 'config', 'view', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
      if (r.code !== 0) throw SourceError('upstream', 'kubectl failed.', r.stderr.trim());
      return readContexts(r.stdout);
    },
    async namespaces(payload, _config, ctx) {
      const context = (payload as { context?: unknown } | null)?.context;
      if (typeof context !== 'string') throw SourceError('upstream', 'Invalid context.');
      try {
        const known = await runCli(['kubectl', 'config', 'view', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
        if (known.code !== 0 || !readContexts(known.stdout).contexts.some((c) => c.name === context)) throw SourceError('upstream', 'Unknown context.');
        const r = await runCli(['kubectl', '--context', context, 'get', 'namespaces', '-o', 'json'], { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
        if (r.code !== 0) return [];
        const items = (JSON.parse(r.stdout) as { items?: { metadata?: { name?: unknown } }[] }).items ?? [];
        return items.map((i) => i.metadata?.name).filter((n): n is string => typeof n === 'string');
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        return [];
      }
    },
    async detail(payload, config, ctx) {
      const { cluster, pod } = pick(config, payload);
      const podJson = await json(cluster, ['get', 'pod', pod], ctx.signal);
      let usage: PodUsage | undefined;
      try {
        const r = await runCli(['kubectl', '--context', cluster.context, 'get', '--raw', `/apis/metrics.k8s.io/v1beta1/namespaces/${cluster.namespace}/pods/${pod}`], {
          timeoutMs: TIMEOUT_MS,
          signal: ctx.signal,
        });
        if (r.code === 0) usage = parseMetrics(JSON.parse(r.stdout));
      } catch (err) {
        if (ctx.signal.aborted) throw err;
      }
      return { pod: sanitizePod(podJson), ...(usage ? { usage } : {}) };
    },
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
