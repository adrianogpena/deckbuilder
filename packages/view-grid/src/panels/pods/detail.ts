import { containerState, podStatus, type Tone } from './status';

export interface PodUsage {
  /** Cores. */
  cpu: number;
  /** Bytes. */
  memory: number;
  containers: Record<string, { cpu: number; memory: number }>;
}

const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';

/** A copy of the pod without `managedFields` and the last-applied annotation. */
export function sanitizePod(json: any): any {
  if (!json || typeof json !== 'object') return json;
  const { managedFields: _managed, ...metadata } = json.metadata ?? {};
  if (metadata.annotations) {
    const { [LAST_APPLIED]: _applied, ...annotations } = metadata.annotations;
    metadata.annotations = annotations;
  }
  return { ...json, metadata };
}

const CPU_SUFFIX: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3 };

/** Cores. */
export function parseCpu(q: unknown): number {
  const m = /^([0-9.eE+-]+)([numk]?)$/.exec(String(q ?? '').trim());
  return m ? Number(m[1]) * (CPU_SUFFIX[m[2]!] ?? 1) || 0 : 0;
}

const MEM_SUFFIX: Record<string, number> = {
  '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60,
  m: 1e-3,
};

/** Bytes. */
export function parseMemory(q: unknown): number {
  const m = /^([0-9.]+(?:[eE][+-]?\d+)?)([a-zA-Z]{0,2})$/.exec(String(q ?? '').trim());
  return m ? Number(m[1]) * (MEM_SUFFIX[m[2]!] ?? 1) || 0 : 0;
}

/** Usage of one pod from a metrics.k8s.io PodMetrics object; undefined when it has no containers. */
export function parseMetrics(raw: any): PodUsage | undefined {
  const list: any[] = raw?.containers ?? [];
  if (!list.length) return undefined;
  const usage: PodUsage = { cpu: 0, memory: 0, containers: {} };
  for (const c of list) {
    const cpu = parseCpu(c.usage?.cpu);
    const memory = parseMemory(c.usage?.memory);
    usage.cpu += cpu;
    usage.memory += memory;
    usage.containers[c.name] = { cpu, memory };
  }
  return usage;
}

export interface Amounts {
  cpu: number;
  memory: number;
}

export interface ContainerOverview {
  name: string;
  init: boolean;
  image: string;
  state: string;
  tone: Tone;
  restarts: number;
  message: string;
  lastTerminated?: { reason: string; exitCode: number | undefined; finishedAt: string };
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
  usage?: Amounts;
}

export interface ConditionOverview {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface PodOverview {
  created: string;
  /** Milliseconds since creation. */
  ageMs: number;
  status: string;
  tone: Tone;
  node: string;
  podIP: string;
  hostIP: string;
  qosClass: string;
  owner: string;
  containers: ContainerOverview[];
  conditions: ConditionOverview[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** 0 means not set; a total only counts when every container defines it. */
  totals: { usage?: Amounts; requests: Amounts; limits: Amounts };
}

function stateMessage(c: any): string {
  const s = c?.state ?? {};
  const x = s.waiting ?? s.terminated;
  return x?.message ?? '';
}

export function podOverview(json: any, usage?: PodUsage, now = Date.now()): PodOverview {
  const meta = json?.metadata ?? {};
  const spec = json?.spec ?? {};
  const st = json?.status ?? {};
  const { text, tone } = podStatus(json);

  const build = (specs: any[], statuses: any[], init: boolean): ContainerOverview[] =>
    specs.map((c) => {
      const s = (statuses ?? []).find((x) => x.name === c.name);
      const state = s ? containerState(s) : { text: 'Unknown', tone: 'info' as Tone };
      const t = s?.lastState?.terminated;
      const u = !init ? usage?.containers[c.name] : undefined;
      return {
        name: c.name,
        init,
        image: c.image ?? '',
        state: state.text,
        tone: state.tone,
        restarts: s?.restartCount ?? 0,
        message: stateMessage(s),
        lastTerminated: t ? { reason: t.reason ?? '', exitCode: t.exitCode, finishedAt: t.finishedAt ?? '' } : undefined,
        requests: { cpu: c.resources?.requests?.cpu ?? '', memory: c.resources?.requests?.memory ?? '' },
        limits: { cpu: c.resources?.limits?.cpu ?? '', memory: c.resources?.limits?.memory ?? '' },
        usage: u,
      };
    });

  const containers: any[] = spec.containers ?? [];
  const sum = (kind: 'requests' | 'limits', res: 'cpu' | 'memory'): number => {
    const parse = res === 'cpu' ? parseCpu : parseMemory;
    return containers.length > 0 && containers.every((c) => c.resources?.[kind]?.[res])
      ? containers.reduce((s, c) => s + parse(c.resources[kind][res]), 0)
      : 0;
  };

  const ownerRefs: any[] = meta.ownerReferences ?? [];
  const ref = ownerRefs.find((o) => o.controller) ?? ownerRefs[0];
  const created: string = meta.creationTimestamp ?? '';
  const createdMs = created ? Date.parse(created) : NaN;
  const { [LAST_APPLIED]: _applied, ...annotations } = (meta.annotations ?? {}) as Record<string, string>;

  return {
    created,
    ageMs: Number.isNaN(createdMs) ? 0 : Math.max(0, now - createdMs),
    status: text,
    tone,
    node: spec.nodeName ?? '',
    podIP: st.podIP ?? '',
    hostIP: st.hostIP ?? '',
    qosClass: st.qosClass ?? '',
    owner: ref ? `${ref.kind}/${ref.name}` : '',
    containers: [
      ...build(spec.initContainers ?? [], st.initContainerStatuses ?? [], true),
      ...build(containers, st.containerStatuses ?? [], false),
    ],
    conditions: (st.conditions ?? []).map((c: any) => ({
      type: c.type ?? '',
      status: c.status ?? '',
      reason: c.reason ?? '',
      message: c.message ?? '',
      lastTransitionTime: c.lastTransitionTime ?? '',
    })),
    labels: meta.labels ?? {},
    annotations,
    totals: {
      usage: usage ? { cpu: usage.cpu, memory: usage.memory } : undefined,
      requests: { cpu: sum('requests', 'cpu'), memory: sum('requests', 'memory') },
      limits: { cpu: sum('limits', 'cpu'), memory: sum('limits', 'memory') },
    },
  };
}
