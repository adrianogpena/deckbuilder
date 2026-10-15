import type { SqlJoinType, SqlStatementOutline } from './outline';

export type LineageNodeKind = 'table' | 'cte' | 'main' | 'target';
export type LineageJoin = SqlJoinType | 'from';

export interface LineageNode {
  id: string;
  kind: LineageNodeKind;
  label: string;
  /** Jump range: CTE name, step start, or first read of a table. */
  from?: number;
  to?: number;
  /** Short badges: 'group by', 'distinct', 'dedupe', 'union all', 'filter ×3', 'agg ×2', 'recursive'. */
  tags: string[];
}

export interface LineageEdge {
  from: string;
  to: string;
  join?: LineageJoin;
  on?: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/** Normalizes a SQL name for identity: quotes dropped, case-insensitive. */
export function sqlNameKey(name: string): string {
  return name.replace(/["`[\]]/g, '').trim().toLowerCase();
}

const TARGET_KINDS = new Set(['insert', 'create', 'merge', 'update']);

function counted(label: string, n: number): string | undefined {
  if (n <= 0) return undefined;
  return n === 1 ? label : `${label} ×${n}`;
}

export function lineageGraph(statement: SqlStatementOutline): LineageGraph {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const byId = new Map<string, LineageNode>();
  const edgeKeys = new Set<string>();
  if (!statement.steps.length) return { nodes, edges };

  const cteKeys = new Set(statement.steps.filter((s) => s.kind === 'cte').map((s) => sqlNameKey(s.name)));
  const stepId = (s: { kind: 'cte' | 'main'; name: string }) => (s.kind === 'main' ? 'main' : `cte:${sqlNameKey(s.name)}`);
  const tables: LineageNode[] = [];

  for (const step of statement.steps) {
    const id = stepId(step);
    if (byId.has(id)) continue;
    const tags: string[] = [];
    if (step.reads.some((r) => step.kind === 'cte' && sqlNameKey(r.name) === sqlNameKey(step.name))) tags.push('recursive');
    if (step.distinct) tags.push('distinct');
    if (step.dedupe) tags.push('dedupe');
    if (step.groupBy.length) tags.push('group by');
    for (const op of new Set(step.setOps)) tags.push(op);
    const f = counted('filter', step.filters.length);
    if (f) tags.push(f);
    const a = counted('agg', step.aggregates.length);
    if (a) tags.push(a);
    const node: LineageNode =
      step.kind === 'main'
        ? { id, kind: 'main', label: 'main', from: step.from, to: step.to, tags }
        : { id, kind: 'cte', label: step.name, from: step.nameFrom ?? step.from, to: step.nameTo ?? step.to, tags };
    byId.set(id, node);
    nodes.push(node);
  }

  for (const step of statement.steps) {
    const to = stepId(step);
    const used = new Set<number>();
    step.reads.forEach((read, i) => {
      const key = sqlNameKey(read.name);
      let src: string;
      if (cteKeys.has(key)) src = `cte:${key}`;
      else {
        src = `table:${key}`;
        if (!byId.has(src)) {
          const t: LineageNode = { id: src, kind: 'table', label: read.name, from: read.from, to: read.to, tags: [] };
          byId.set(src, t);
          tables.push(t);
        }
      }
      if (src === to) return;
      let join: LineageJoin = 'from';
      let on: string | undefined;
      if (i > 0) {
        const j = step.joins.findIndex(
          (jn, k) => !used.has(k) && sqlNameKey(jn.target) === key && (jn.alias ?? '') === (read.alias ?? ''),
        );
        if (j >= 0) {
          used.add(j);
          join = step.joins[j]!.type;
          on = step.joins[j]!.on;
        }
      }
      const ek = `${src}\u0000${to}`;
      if (edgeKeys.has(ek)) return;
      edgeKeys.add(ek);
      edges.push(on === undefined ? { from: src, to, join } : { from: src, to, join, on });
    });
  }

  if (statement.target && TARGET_KINDS.has(statement.kind) && byId.has('main')) {
    const t: LineageNode = { id: 'target', kind: 'target', label: statement.target, tags: [] };
    nodes.push(t);
    edges.push({ from: 'main', to: 'target' });
  }
  return { nodes: [...tables, ...nodes], edges };
}

/** The node plus all its ancestors and descendants. */
export function lineageOf(graph: LineageGraph, nodeId: string): Set<string> {
  const out = new Set<string>();
  if (!graph.nodes.some((n) => n.id === nodeId)) return out;
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const e of graph.edges) {
    (up.get(e.to) ?? up.set(e.to, []).get(e.to)!).push(e.from);
    (down.get(e.from) ?? down.set(e.from, []).get(e.from)!).push(e.to);
  }
  out.add(nodeId);
  for (const adj of [up, down]) {
    const seen = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      for (const next of adj.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  heightOf?: (node: LineageNode) => number;
  rankGap?: number;
  nodeGap?: number;
  direction?: 'LR';
}

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface Layout {
  width: number;
  height: number;
  nodes: Map<string, LayoutBox>;
  edges: { from: string; to: string; points: LayoutPoint[] }[];
}

/** Layered (Sugiyama-style) left-to-right layout. */
export function layoutGraph(graph: LineageGraph, opts: LayoutOptions = {}): Layout {
  const nodeWidth = opts.nodeWidth ?? 168;
  const nodeHeight = opts.nodeHeight ?? 44;
  const rankGap = opts.rankGap ?? 64;
  const nodeGap = opts.nodeGap ?? 20;
  const n = graph.nodes.length;
  const layout: Layout = { width: 0, height: 0, nodes: new Map(), edges: [] };
  if (!n) return layout;

  const index = new Map<string, number>();
  graph.nodes.forEach((nd, i) => index.set(nd.id, i));

  // Real edges (self-loops and dangling ends dropped).
  const realEdges: { s: number; t: number; e: number }[] = [];
  graph.edges.forEach((e, k) => {
    const s = index.get(e.from);
    const t = index.get(e.to);
    if (s === undefined || t === undefined || s === t) return;
    realEdges.push({ s, t, e: k });
  });
  const out: number[][] = Array.from({ length: n }, () => []);
  realEdges.forEach((re, k) => out[re.s]!.push(k));

  // Break cycles: iterative DFS, reverse back edges.
  const reversed = new Uint8Array(realEdges.length);
  const state = new Uint8Array(n); // 0 new, 1 on stack, 2 done
  const indeg = new Int32Array(n);
  for (const re of realEdges) indeg[re.t]!++;
  const roots = [...Array(n).keys()].sort((a, b) => indeg[a]! - indeg[b]! || a - b);
  for (const root of roots) {
    if (state[root]) continue;
    const stack: [number, number][] = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const list = out[top[0]]!;
      if (top[1] >= list.length) {
        state[top[0]] = 2;
        stack.pop();
        continue;
      }
      const k = list[top[1]++]!;
      const t = realEdges[k]!.t;
      if (state[t] === 1) reversed[k] = 1;
      else if (state[t] === 0) {
        state[t] = 1;
        stack.push([t, 0]);
      }
    }
  }

  // Ranks: longest path from sources (Kahn on the DAG).
  const dagOut: number[][] = Array.from({ length: n }, () => []);
  const din = new Int32Array(n);
  realEdges.forEach((re, k) => {
    const [s, t] = reversed[k] ? [re.t, re.s] : [re.s, re.t];
    dagOut[s]!.push(t);
    din[t]!++;
  });
  const rank = new Int32Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (!din[i]) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi]!;
    for (const t of dagOut[v]!) {
      if (rank[v]! + 1 > rank[t]!) rank[t] = rank[v]! + 1;
      if (--din[t]! === 0) queue.push(t);
    }
  }
  let maxRank = 0;
  graph.nodes.forEach((nd, i) => {
    if (nd.kind !== 'target' && rank[i]! > maxRank) maxRank = rank[i]!;
  });
  graph.nodes.forEach((nd, i) => {
    if (nd.kind === 'target') rank[i] = maxRank + 1;
  });
  for (let i = 0; i < n; i++) if (rank[i]! > maxRank) maxRank = rank[i]!;

  // Layered graph with virtual nodes for long edges.
  const vRank: number[] = Array.from(rank);
  const h: number[] = graph.nodes.map((nd) => (opts.heightOf ? opts.heightOf(nd) : nodeHeight));
  const preds: number[][] = Array.from({ length: n }, () => []);
  const succs: number[][] = Array.from({ length: n }, () => []);
  const chains: number[][] = [];
  realEdges.forEach((re, k) => {
    const [s, t] = reversed[k] ? [re.t, re.s] : [re.s, re.t];
    const chain = [s];
    for (let r = vRank[s]! + 1; r < vRank[t]!; r++) {
      const v = vRank.length;
      vRank.push(r);
      h.push(0);
      preds.push([]);
      succs.push([]);
      chain.push(v);
    }
    chain.push(t);
    for (let i = 1; i < chain.length; i++) {
      succs[chain[i - 1]!]!.push(chain[i]!);
      preds[chain[i]!]!.push(chain[i - 1]!);
    }
    chains.push(chain);
  });
  const total = vRank.length;
  const layers: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (let v = 0; v < total; v++) layers[vRank[v]!]!.push(v);

  // Ordering: barycenter, 4 down/up sweeps.
  const pos = new Float64Array(total);
  const setPos = (layer: number[]) => layer.forEach((v, i) => (pos[v] = i));
  layers.forEach(setPos);
  const key = new Float64Array(total);
  const sortLayer = (layer: number[], adj: number[][]) => {
    for (const v of layer) {
      const a = adj[v]!;
      if (!a.length) key[v] = pos[v]!;
      else {
        let sum = 0;
        for (const u of a) sum += pos[u]!;
        key[v] = sum / a.length;
      }
    }
    layer.sort((a, b) => key[a]! - key[b]! || pos[a]! - pos[b]!);
    setPos(layer);
  };
  for (let it = 0; it < 4; it++) {
    for (let r = 1; r <= maxRank; r++) sortLayer(layers[r]!, preds);
    for (let r = maxRank - 1; r >= 0; r--) sortLayer(layers[r]!, succs);
  }

  // Coordinates: stack, then median alignment with order-preserving overlap resolution.
  const y = new Float64Array(total);
  for (const layer of layers) {
    let acc = 0;
    for (const v of layer) {
      y[v] = acc;
      acc += h[v]! + nodeGap;
    }
  }
  const center = (v: number) => y[v]! + h[v]! / 2;
  const align = (layer: number[], adj: number[][]) => {
    const m = layer.length;
    if (!m) return;
    const d = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const v = layer[i]!;
      const a = adj[v]!;
      if (!a.length) d[i] = y[v]!;
      else {
        const cs = a.map(center).sort((p, q) => p - q);
        const mid = cs.length >> 1;
        const med = cs.length % 2 ? cs[mid]! : (cs[mid - 1]! + cs[mid]!) / 2;
        d[i] = med - h[v]! / 2;
      }
    }
    const f = new Float64Array(m);
    const b = new Float64Array(m);
    f[0] = d[0]!;
    for (let i = 1; i < m; i++) f[i] = Math.max(d[i]!, f[i - 1]! + h[layer[i - 1]!]! + nodeGap);
    b[m - 1] = d[m - 1]!;
    for (let i = m - 2; i >= 0; i--) b[i] = Math.min(d[i]!, b[i + 1]! - nodeGap - h[layer[i]!]!);
    for (let i = 0; i < m; i++) y[layer[i]!] = (f[i]! + b[i]!) / 2;
  };
  for (let it = 0; it < 4; it++) {
    if (it % 2 === 0) for (let r = 1; r <= maxRank; r++) align(layers[r]!, preds);
    else for (let r = maxRank - 1; r >= 0; r--) align(layers[r]!, succs);
  }
  let minY = Infinity;
  let maxY = 0;
  for (let v = 0; v < total; v++) minY = Math.min(minY, y[v]!);
  for (let v = 0; v < total; v++) {
    y[v] = y[v]! - minY;
    maxY = Math.max(maxY, y[v]! + h[v]!);
  }

  const colX = (r: number) => r * (nodeWidth + rankGap);
  graph.nodes.forEach((nd, i) => layout.nodes.set(nd.id, { x: colX(rank[i]!), y: y[i]!, w: nodeWidth, h: h[i]! }));
  realEdges.forEach((re, k) => {
    const chain = chains[k]!;
    const s = chain[0]!;
    const t = chain[chain.length - 1]!;
    const points: LayoutPoint[] = [{ x: colX(vRank[s]!) + nodeWidth, y: center(s) }];
    for (let i = 1; i < chain.length - 1; i++) {
      const v = chain[i]!;
      points.push({ x: colX(vRank[v]!), y: y[v]! }, { x: colX(vRank[v]!) + nodeWidth, y: y[v]! });
    }
    points.push({ x: colX(vRank[t]!), y: center(t) });
    if (reversed[k]) points.reverse();
    const e = graph.edges[re.e]!;
    layout.edges.push({ from: e.from, to: e.to, points });
  });
  layout.width = colX(maxRank) + nodeWidth;
  layout.height = maxY;
  return layout;
}
