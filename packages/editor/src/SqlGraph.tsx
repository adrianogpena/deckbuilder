import { Icon, PanelNotice, t } from '@deckbuilder/ui';
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SqlProblem } from './sql/lint';
import { type LayoutPoint, type LineageEdge, type LineageNode, layoutGraph, lineageGraph, lineageOf, sqlNameKey } from './sql/lineage';
import type { SqlOutline, SqlStatementOutline, SqlStep } from './sql/outline';

export interface SqlGraphProps {
  outline: SqlOutline;
  problems: readonly SqlProblem[];
  cursor?: number;
  onJump(from: number, to?: number): void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const PAD = 16;
const PAN_STEP = 40;
const CHAR_W = 7;
const TAG_CHAR_W = 6;
const OUTER = new Set(['left', 'right', 'full']);

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

function statementTitle(s: SqlStatementOutline): string {
  const kind = t(`sqlSteps.kind.${s.kind}`);
  return s.target ? `${kind} ${s.target}` : kind;
}

function nodeLabel(n: LineageNode): string {
  return n.kind === 'main' ? t('sqlSteps.main') : n.label;
}

function fitText(text: string, width: number, charW: number): string {
  const max = Math.max(1, Math.floor(width / charW));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** A smooth path through the points: horizontal tangents at each point, as the layout runs left to right. */
function edgePath(points: readonly LayoutPoint[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = (b.x - a.x) / 2;
    d += ` C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

function stepOf(statement: SqlStatementOutline, node: LineageNode): SqlStep | undefined {
  if (node.kind === 'main') return statement.steps.find((s) => s.kind === 'main');
  if (node.kind === 'cte') return statement.steps.find((s) => s.kind === 'cte' && `cte:${sqlNameKey(s.name)}` === node.id);
  return undefined;
}

/** The lineage of one statement as a left-to-right graph: tables and CTEs feeding the main query. */
export function SqlGraph({ outline, problems, cursor, onJump }: SqlGraphProps) {
  const markerId = `sqlgraph-arrow-${useId().replace(/:/g, '')}`;
  const candidates = useMemo(() => outline.statements.map((s, i) => ({ s, i })).filter((x) => x.s.steps.length > 0), [outline]);
  const [picked, setPicked] = useState<number>();
  const atCursor = useMemo(() => {
    if (cursor === undefined) return candidates[0]?.i;
    return (candidates.find(({ s }) => cursor >= s.from && cursor <= s.to) ?? candidates[0])?.i;
  }, [candidates, cursor]);
  const current = picked !== undefined && candidates.some((c) => c.i === picked) ? picked : atCursor;
  const statement = current === undefined ? undefined : outline.statements[current];

  const graph = useMemo(() => (statement ? lineageGraph(statement) : { nodes: [], edges: [] }), [statement]);
  const layout = useMemo(() => layoutGraph(graph, { heightOf: (n) => (n.tags.length > 0 ? 52 : 34), rankGap: 120, nodeGap: 26 }), [graph]);
  const edgeInfo = useMemo(() => {
    const map = new Map<string, LineageEdge>();
    for (const e of graph.edges) if (!map.has(`${e.from}>${e.to}`)) map.set(`${e.from}>${e.to}`, e);
    return map;
  }, [graph]);
  const flagged = useMemo(() => {
    const set = new Set<string>();
    for (const p of problems) {
      if (p.statement !== current || p.step === undefined) continue;
      set.add(p.step === '' ? 'main' : `cte:${sqlNameKey(p.step)}`);
    }
    return set;
  }, [problems, current]);

  const [focus, setFocus] = useState<Set<string>>();
  const [hover, setHover] = useState<{ node: LineageNode; x: number; y: number }>();
  const box = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const setView = useCallback((next: View) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || layout.width === 0) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const k = clampZoom(Math.min((cw - PAD * 2) / layout.width, (ch - PAD * 2) / layout.height, 1.25));
    setView({ x: (cw - layout.width * k) / 2, y: (ch - layout.height * k) / 2, k });
  }, [layout, setView]);

  useLayoutEffect(() => {
    setFocus(undefined);
    fit();
    // Refit when the statement (or its shape) changes, not on every edit.
  }, [current, graph.nodes.length]);

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = box.current;
    const v = viewRef.current;
    const x0 = px ?? (el ? el.clientWidth / 2 : 0);
    const y0 = py ?? (el ? el.clientHeight / 2 : 0);
    const k = clampZoom(v.k * factor);
    setView({ x: x0 - ((x0 - v.x) * k) / v.k, y: y0 - ((y0 - v.y) * k) / v.k, k });
  }, [setView]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.004 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, statement]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const moved = useRef(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const v = viewRef.current;
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
    moved.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      moved.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setHover(undefined);
    }
    setView({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (drag.current?.moved) (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const v = viewRef.current;
    const pan: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
    const step = pan[e.key];
    if (step) setView({ ...v, x: v.x + step[0], y: v.y + step[1] });
    else if (e.key === '+' || e.key === '=') zoomAt(1.2);
    else if (e.key === '-') zoomAt(1 / 1.2);
    else if (e.key === '0') fit();
    else if (e.key === 'Escape' && focus) setFocus(undefined);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const showTip = (node: LineageNode, e: ReactMouseEvent) => {
    if (drag.current?.moved) return;
    const r = box.current?.getBoundingClientRect();
    if (r) setHover({ node, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const lit = focus ?? (hover ? lineageOf(graph, hover.node.id) : undefined);
  const tipStep = hover && statement ? stepOf(statement, hover.node) : undefined;

  if (candidates.length === 0 || !statement) {
    return <PanelNotice icon={<Icon name="list-tree" size={20} />} title={t('sqlSteps.graph.empty')} message={t('sqlSteps.graph.emptyHint')} />;
  }

  return (
    <div className="sqlgraph">
      <div className="sqlgraph-bar">
        <select
          className="sqlgraph-select"
          value={current}
          onChange={(e) => setPicked(Number(e.target.value))}
          aria-label={t('sqlSteps.graph.statement')}
          title={t('sqlSteps.graph.statement')}
        >
          {candidates.map(({ s, i }) => (
            <option key={i} value={i}>{t('sqlSteps.graph.option', { n: i + 1, title: statementTitle(s) })}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={fit} title={t('sqlSteps.graph.fit')} aria-label={t('sqlSteps.graph.fit')}>
          <Icon name="maximize" />
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => zoomAt(1.2)} title={t('sqlSteps.graph.zoomIn')} aria-label={t('sqlSteps.graph.zoomIn')}>
          <Icon name="plus" />
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => zoomAt(1 / 1.2)} title={t('sqlSteps.graph.zoomOut')} aria-label={t('sqlSteps.graph.zoomOut')}>
          <span className="sqlgraph-minus" aria-hidden="true">−</span>
        </button>
      </div>
      <div
        ref={box}
        className="sqlgraph-canvas"
        tabIndex={0}
        role="img"
        aria-label={t('sqlSteps.graph.label')}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setFocus(undefined)}
      >
        <svg className="sqlgraph-svg">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="sqlgraph-arrow" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {layout.edges.map((e, i) => {
              const info = edgeInfo.get(`${e.from}>${e.to}`);
              const hot = !!lit && lit.has(e.from) && lit.has(e.to);
              const dim = !!lit && !hot;
              const end = e.points[e.points.length - 1];
              const join = info?.join && info.join !== 'from' ? info.join : undefined;
              return (
                <g key={i} className={`sqlgraph-edge${dim ? ' is-dim' : ''}${hot ? ' is-hot' : ''}${join && OUTER.has(join) ? ' is-outer' : ''}`}>
                  <path d={edgePath(e.points)} markerEnd={`url(#${markerId})`}>
                    {info?.on && <title>{info.on}</title>}
                  </path>
                  {join && end && <text className="sqlgraph-join" x={end.x - 6} y={end.y - 5} textAnchor="end">{join}</text>}
                </g>
              );
            })}
            {graph.nodes.map((n) => {
              const b = layout.nodes.get(n.id);
              if (!b) return null;
              const dim = !!lit && !lit.has(n.id);
              const label = nodeLabel(n);
              let tagX = 10;
              return (
                <g
                  key={n.id}
                  className={`sqlgraph-node is-${n.kind}${dim ? ' is-dim' : ''}${n.from !== undefined ? ' is-link' : ''}`}
                  transform={`translate(${b.x} ${b.y})`}
                  onClick={() => {
                    if (!moved.current && n.from !== undefined) onJump(n.from, n.to);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setFocus(lineageOf(graph, n.id));
                  }}
                  onMouseEnter={(e) => showTip(n, e)}
                  onMouseMove={(e) => showTip(n, e)}
                  onMouseLeave={() => setHover(undefined)}
                >
                  <rect className="sqlgraph-base" width={b.w} height={b.h} rx={6} />
                  <rect className="sqlgraph-box" width={b.w} height={b.h} rx={6} />
                  <text className="sqlgraph-label" x={10} y={21}>{fitText(label, b.w - 24, CHAR_W)}</text>
                  {n.tags.slice(0, 2).map((tag) => {
                    const room = b.w - 8 - tagX;
                    if (room < 24) return null;
                    const text = fitText(tag, room - 12, TAG_CHAR_W);
                    const w = Math.min(room, text.length * TAG_CHAR_W + 12);
                    const x = tagX;
                    tagX += w + 4;
                    return (
                      <g key={tag} transform={`translate(${x} 30)`}>
                        <rect className="sqlgraph-tag" width={w} height={15} rx={7.5} />
                        <text className="sqlgraph-tag-text" x={w / 2} y={11} textAnchor="middle">{text}</text>
                      </g>
                    );
                  })}
                  {flagged.has(n.id) && (
                    <circle className="sqlgraph-dot" cx={b.w - 9} cy={9} r={4}>
                      <title>{t('sqlSteps.graph.hasProblems')}</title>
                    </circle>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {hover && (
          <div className="sqlgraph-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <div className="sqlgraph-tip-head">
              <strong>{nodeLabel(hover.node)}</strong>
              <span className="muted">{t(`sqlSteps.graph.kind.${hover.node.kind}`)}</span>
            </div>
            {tipStep && tipStep.joins.length > 0 && (
              <div className="sqlgraph-tip-row">
                <span className="muted">{t('sqlSteps.joins')}</span>
                {tipStep.joins.slice(0, 4).map((j, i) => <code key={i}>{j.type} {j.target}{j.on ? ` ${t('sqlSteps.on')} ${j.on}` : ''}</code>)}
              </div>
            )}
            {tipStep && tipStep.filters.length > 0 && (
              <div className="sqlgraph-tip-row">
                <span className="muted">{t('sqlSteps.filters')}</span>
                {tipStep.filters.slice(0, 4).map((f, i) => <code key={i}>{f}</code>)}
              </div>
            )}
            {hover.node.tags.length > 0 && <div className="muted">{hover.node.tags.join(', ')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
