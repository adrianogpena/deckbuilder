import { describe, expect, test } from 'bun:test';
import { layoutGraph, lineageGraph, lineageOf, type LineageGraph } from './lineage.ts';
import { sqlOutline } from './outline.ts';

const SQL = `insert into report_out
with a as (select * from Customers c where c.x = 1 and c.y = 2),
b as (select c.id, count(*), sum(c.v) from "CUSTOMERS" c left join a on a.id = c.id group by c.id),
d as (select distinct id from b)
select * from d inner join orders o on o.id = d.id, a`;

const graphOf = (sql: string) => lineageGraph(sqlOutline(sql).statements[0]!);

function noOverlaps(g: LineageGraph) {
  const l = layoutGraph(g);
  const boxes = [...l.nodes.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
  for (const b of boxes) {
    expect(b.x + b.w).toBeLessThanOrEqual(l.width);
    expect(b.y + b.h).toBeLessThanOrEqual(l.height + 1e-6);
    expect(b.y).toBeGreaterThanOrEqual(0);
  }
  return l;
}

describe('lineageGraph', () => {
  test('multi-CTE statement', () => {
    const g = graphOf(SQL);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([
      ['table:customers', 'table'],
      ['table:orders', 'table'],
      ['cte:a', 'cte'],
      ['cte:b', 'cte'],
      ['cte:d', 'cte'],
      ['main', 'main'],
      ['target', 'target'],
    ]);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get('target')!.label).toBe('report_out');
    expect(byId.get('cte:a')!.tags).toEqual(['filter ×2']);
    expect(byId.get('cte:b')!.tags).toEqual(['group by', 'agg ×2']);
    expect(byId.get('cte:d')!.tags).toEqual(['distinct']);
    expect(SQL.slice(byId.get('cte:b')!.from, byId.get('cte:b')!.to)).toBe('b');
    expect(g.edges.map((e) => [e.from, e.to, e.join])).toEqual([
      ['table:customers', 'cte:a', 'from'],
      ['table:customers', 'cte:b', 'from'],
      ['cte:a', 'cte:b', 'left'],
      ['cte:b', 'cte:d', 'from'],
      ['cte:d', 'main', 'from'],
      ['table:orders', 'main', 'inner'],
      ['cte:a', 'main', 'comma'],
      ['main', 'target', undefined],
    ]);
    expect(g.edges.find((e) => e.to === 'cte:b' && e.join === 'left')!.on).toBe('a.id = c.id');
  });

  test('lineageOf gives ancestors and descendants', () => {
    const g = graphOf(SQL);
    expect([...lineageOf(g, 'cte:d')].sort()).toEqual(['cte:a', 'cte:b', 'cte:d', 'main', 'table:customers', 'target']);
    expect([...lineageOf(g, 'table:orders')].sort()).toEqual(['main', 'table:orders', 'target']);
    expect(lineageOf(g, 'nope').size).toBe(0);
  });

  test('empty and PL/SQL statements give an empty graph', () => {
    const out = sqlOutline('begin\n  update x set y = 1;\nend;\n/\n');
    expect(lineageGraph(out.statements[0]!)).toEqual({ nodes: [], edges: [] });
    expect(lineageGraph({ from: 0, to: 0, kind: 'other', steps: [] })).toEqual({ nodes: [], edges: [] });
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual({ width: 0, height: 0, nodes: new Map(), edges: [] });
  });
});

describe('layoutGraph', () => {
  test('ranks by longest path, target last, no overlaps', () => {
    const l = noOverlaps(graphOf(SQL));
    const col = (id: string) => l.nodes.get(id)!.x / (168 + 64);
    expect(['table:customers', 'table:orders', 'cte:a', 'cte:b', 'cte:d', 'main', 'target'].map(col)).toEqual([0, 0, 1, 2, 3, 4, 5]);
  });

  test('long edges get virtual waypoints', () => {
    const l = layoutGraph(graphOf(SQL));
    const e = l.edges.find((x) => x.from === 'table:orders' && x.to === 'main')!;
    expect(e.points).toHaveLength(2 + 2 * 3);
    const xs = e.points.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const short = l.edges.find((x) => x.from === 'main' && x.to === 'target')!;
    expect(short.points).toHaveLength(2);
  });

  test('cycle does not hang', () => {
    const g = graphOf('with a as (select * from b), b as (select * from a) select * from a');
    expect(g.edges.some((e) => e.from === 'cte:a' && e.to === 'cte:b')).toBe(true);
    expect(g.edges.some((e) => e.from === 'cte:b' && e.to === 'cte:a')).toBe(true);
    const l = noOverlaps(g);
    expect(l.edges).toHaveLength(g.edges.length);
  });

  test('heightOf sets node heights', () => {
    const l = noOverlaps(graphOf(SQL));
    const tall = layoutGraph(graphOf(SQL), { heightOf: (n) => 44 + 12 * n.tags.length });
    expect(tall.nodes.get('cte:b')!.h).toBe(68);
    expect(l.nodes.get('cte:b')!.h).toBe(44);
  });

  test('200 nodes / 400 edges in under 50 ms', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, kind: 'cte' as const, label: `n${i}`, tags: [] }));
    const edges = Array.from({ length: 400 }, () => {
      const a = Math.floor(rnd() * 200);
      const b = Math.floor(rnd() * 200);
      return { from: `n${Math.min(a, b)}`, to: `n${Math.max(a, b) === Math.min(a, b) ? (a + 1) % 200 : Math.max(a, b)}` };
    });
    edges.push({ from: 'n150', to: 'n3' });
    const g = { nodes, edges };
    const t0 = performance.now();
    const l = layoutGraph(g);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50);
    expect(l.nodes.size).toBe(200);
    noOverlaps(g);
  });
});
