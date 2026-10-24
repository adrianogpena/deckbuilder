import { podStatus, type Tone } from './status';

export interface PodsConfig {
  clusters: string;
  refreshSec: number;
  showHealthy: boolean;
  notifyHealth: boolean;
}

/** One tracked line: a context, a namespace and a full or partial pod name. */
export interface PodEntry {
  context: string;
  namespace: string;
  pod: string;
}

export interface PodRow {
  entry: PodEntry;
  pod: Pod | undefined;
}

export interface Cluster {
  context: string;
  namespace: string;
  patterns: string[];
}

export interface Pod {
  /** `<context>/<namespace>`. */
  cluster: string;
  context: string;
  namespace: string;
  name: string;
  status: string;
  /** Optional so hand-built pods in other panels' tests keep compiling; `mapPods` always sets it. */
  tone?: Tone;
  healthy: boolean;
  /** `ready/total` containers. */
  ready: string;
  restarts: number;
  lastRestartAt: string;
  startedAt: string;
  images: string[];
  labels: Record<string, string>;
  urls: string[];
}

export const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** One cluster per line: `<context> <namespace> <pattern>[,<pattern>…]`; blank lines, `#` comments and malformed lines are skipped. */
export function parseClusters(text: string): Cluster[] {
  const out: Cluster[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [context, namespace, rest = ''] = trimmed.split(/\s+/, 3);
    if (!context || !namespace || !DNS_1123.test(namespace)) continue;
    const patterns = rest.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    out.push({ context, namespace, patterns });
  }
  return out;
}

/** Case-insensitive substring match against any pattern; no patterns tracks nothing. */
export const isTracked = (name: string, patterns: readonly string[]): boolean => {
  const n = name.toLowerCase();
  return patterns.some((p) => p && n.includes(p.toLowerCase()));
};

/** One entry per line `<context> <namespace> <pod>`; old `<p1>,<p2>` lines split into one entry per pattern. */
export function parseEntries(text: string): PodEntry[] {
  const out: PodEntry[] = [];
  for (const c of parseClusters(text)) {
    for (const pod of c.patterns) out.push({ context: c.context, namespace: c.namespace, pod });
  }
  return out;
}

export const formatEntries = (entries: readonly PodEntry[]): string =>
  entries.map((e) => `${e.context} ${e.namespace} ${e.pod}`).join('\n');

/** Case-insensitive substring match of the entry's pod text against the pod name. */
export const matchesEntry = (name: string, pod: string): boolean => !!pod && name.toLowerCase().includes(pod.toLowerCase());

/** Rows in entry order; a pod shows once, under the first entry that matches it. An entry without pods gets one empty row. */
export function podRows(entries: readonly PodEntry[], pods: readonly Pod[]): PodRow[] {
  const seen = new Set<string>();
  const rows: PodRow[] = [];
  for (const entry of entries) {
    let any = false;
    for (const pod of pods) {
      if (pod.context !== entry.context || pod.namespace !== entry.namespace || !matchesEntry(pod.name, entry.pod)) continue;
      any = true;
      const key = `${pod.context}/${pod.namespace}/${pod.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ entry, pod });
    }
    if (!any) rows.push({ entry, pod: undefined });
  }
  return rows;
}

const podKey = (p: Pod) => `${p.context}/${p.namespace}/${p.name}`;

/** Pods whose health flipped since `prev` (updated in place); first-seen pods never count. */
export function healthChanges(prev: Map<string, boolean>, pods: readonly Pod[]): { pod: Pod; healthy: boolean }[] {
  const out: { pod: Pod; healthy: boolean }[] = [];
  for (const pod of pods) {
    const key = podKey(pod);
    const before = prev.get(key);
    if (before !== undefined && before !== pod.healthy) out.push({ pod, healthy: pod.healthy });
    prev.set(key, pod.healthy);
  }
  return out;
}

interface ContainerStatus {
  ready?: boolean;
  restartCount?: number;
  image?: string;
  state?: { waiting?: { reason?: string }; terminated?: { reason?: string } };
  lastState?: { terminated?: { finishedAt?: string } };
}

interface PodJson {
  metadata?: { name?: string; labels?: Record<string, string>; creationTimestamp?: string };
  spec?: { containers?: { image?: string }[] };
  status?: { phase?: string; startTime?: string; containerStatuses?: ContainerStatus[] };
}

/** The tracked pods of a `get pods -o json` result. */
export function mapPods(json: unknown, cluster: Cluster): Pod[] {
  const items = (json as { items?: PodJson[] } | null)?.items ?? [];
  const pods: Pod[] = [];
  for (const p of items) {
    const name = p.metadata?.name ?? '';
    if (!name || !isTracked(name, cluster.patterns)) continue;
    const statuses = p.status?.containerStatuses ?? [];
    const { text: status, tone } = podStatus(p);
    const readyCount = statuses.filter((c) => c.ready).length;
    const total = statuses.length || (p.spec?.containers?.length ?? 0);
    let lastRestartAt = '';
    for (const c of statuses) {
      const at = c.lastState?.terminated?.finishedAt ?? '';
      if (at > lastRestartAt) lastRestartAt = at;
    }
    pods.push({
      cluster: `${cluster.context}/${cluster.namespace}`,
      context: cluster.context,
      namespace: cluster.namespace,
      name,
      status,
      tone,
      healthy: status === 'Running' && statuses.length > 0 && readyCount === statuses.length,
      ready: `${readyCount}/${total}`,
      restarts: statuses.reduce((n, c) => n + (c.restartCount ?? 0), 0),
      lastRestartAt,
      startedAt: p.status?.startTime ?? p.metadata?.creationTimestamp ?? '',
      images: (p.spec?.containers ?? []).map((c) => c.image ?? '').filter(Boolean),
      labels: p.metadata?.labels ?? {},
      urls: [],
    });
  }
  return pods;
}

interface IngressJson {
  spec?: {
    tls?: { hosts?: string[] }[];
    rules?: { host?: string; http?: { paths?: { path?: string; backend?: { service?: { name?: string }; serviceName?: string } }[] } }[];
  };
}

/** URLs of the ingress rules whose backend service is named like one of the pod's label values or is a prefix of the pod name. */
export function ingressUrls(ingressJson: unknown, labels: Record<string, string>, podName = ''): string[] {
  const values = new Set(Object.values(labels));
  const urls = new Set<string>();
  for (const ing of (ingressJson as { items?: IngressJson[] } | null)?.items ?? []) {
    const tlsHosts = new Set((ing.spec?.tls ?? []).flatMap((t) => t.hosts ?? []));
    for (const rule of ing.spec?.rules ?? []) {
      if (!rule.host) continue;
      for (const path of rule.http?.paths ?? []) {
        const service = path.backend?.service?.name ?? path.backend?.serviceName ?? '';
        if (!service || !(values.has(service) || (podName && podName.startsWith(`${service}-`)))) continue;
        const p = path.path && path.path !== '/' ? path.path.replace(/\(.*$/, '') : '';
        urls.add(`${tlsHosts.has(rule.host) ? 'https' : 'http'}://${rule.host}${p}`);
      }
    }
  }
  return [...urls];
}

/** Names of the ConfigMaps a pod mounts or references (volumes, env, envFrom). */
export function podConfigMaps(podJson: unknown): string[] {
  const spec = (podJson as { spec?: Record<string, any> } | null)?.spec ?? {};
  const names = new Set<string>();
  for (const v of spec.volumes ?? []) {
    if (v.configMap?.name) names.add(v.configMap.name);
    for (const s of v.projected?.sources ?? []) if (s.configMap?.name) names.add(s.configMap.name);
  }
  for (const c of [...(spec.containers ?? []), ...(spec.initContainers ?? [])]) {
    for (const e of c.envFrom ?? []) if (e.configMapRef?.name) names.add(e.configMapRef.name);
    for (const e of c.env ?? []) if (e.valueFrom?.configMapKeyRef?.name) names.add(e.valueFrom.configMapKeyRef.name);
  }
  return [...names].filter((n) => DNS_1123.test(n) || /^[a-z0-9][-a-z0-9.]*[a-z0-9]$/.test(n));
}
