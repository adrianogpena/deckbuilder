import { Badge, Icon, PanelNotice, t } from '@deckbuilder/ui';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { SqlGraph } from './SqlGraph';
import { type SqlLintSeverity, type SqlProblem, sqlLint } from './sql/lint';
import { type SqlParam, sqlParams } from './sql/markers';
import { type SqlStatementOutline, type SqlStep, sqlOutline } from './sql/outline';
import { lineOf, lineStarts, SQL_SEVERITIES, sqlProblemMessage, worstSeverity } from './sqlProblems';

export type SqlStepsTab = 'steps' | 'graph' | 'params' | 'problems';

export interface SqlStepsProps {
  text: string;
  onJump(from: number, to?: number): void;
  /** Offset of the editor cursor; the card holding it is highlighted. */
  cursor?: number;
  onClose?(): void;
  /** The open tab; uncontrolled ('steps' first) without it. */
  tab?: SqlStepsTab;
  onTab?(tab: SqlStepsTab): void;
  /** Panel width in px (default 300); the left edge drags it, reporting the new width on release. */
  width?: number;
  onWidth?(width: number): void;
  /** Fill a bottom panel (no fixed width, no resize edge) instead of a right side panel. */
  bottom?: boolean;
  /** Values of the `{n}` parameters; the Parameters tab shows an input per parameter when `onParamValue` is given. */
  paramValues?: Record<number, string>;
  onParamValue?(n: number, value: string): void;
}

const MAIN = 'main';
const TABS: readonly SqlStepsTab[] = ['steps', 'graph', 'params', 'problems'];
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 260;
const MAX_SHARE = 0.7;
const RESIZE_STEP = 16;

function SeverityIcon({ severity }: { severity: SqlLintSeverity }) {
  return (
    <span className={`sqlsteps-sev is-${severity}`} aria-label={t(`sqlSteps.severity.${severity}`)}>
      {severity === 'info' ? <span className="sqlsteps-sev-dot" /> : <Icon name="alert" size={13} />}
    </span>
  );
}

function ProblemList({ problems, text, outline, filter, onClearFilter, onJump }: {
  problems: readonly SqlProblem[];
  text: string;
  outline: { statements: SqlStatementOutline[] };
  filter?: { statement: number; step: string };
  onClearFilter(): void;
  onJump(from: number, to?: number): void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<SqlLintSeverity>>(new Set());
  const starts = useMemo(() => lineStarts(text), [text]);
  const counts = useMemo(() => {
    const c: Record<SqlLintSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const p of problems) c[p.severity]++;
    return c;
  }, [problems]);
  const shown = useMemo(
    () => problems
      .filter((p) => !hidden.has(p.severity) && (!filter || (p.statement === filter.statement && p.step === filter.step)))
      .sort((a, b) => a.from - b.from || a.to - b.to),
    [problems, hidden, filter],
  );
  const toggle = (s: SqlLintSeverity) => setHidden((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    return next;
  });

  if (problems.length === 0) {
    return <PanelNotice icon={<Icon name="check" size={20} />} title={t('sqlSteps.problems.none')} message={t('sqlSteps.problems.noneHint')} />;
  }
  return (
    <>
      <div className="sqlsteps-chips">
        {SQL_SEVERITIES.map((s) => (
          <button key={s} className={`sqlsteps-chip is-${s}`} aria-pressed={!hidden.has(s)} onClick={() => toggle(s)} disabled={counts[s] === 0}>
            <SeverityIcon severity={s} /> {t(`sqlSteps.severity.${s}`)} <span className="sqlsteps-chip-count">{counts[s]}</span>
          </button>
        ))}
      </div>
      {filter && (
        <div className="sqlsteps-infilter">
          <span className="muted">{t('sqlSteps.problems.inStep', { step: filter.step || t('sqlSteps.main') })}</span>
          <button className="sqlsteps-feed" onClick={onClearFilter}>{t('sqlSteps.problems.showAll')}</button>
        </div>
      )}
      <div className="sqlsteps-list">
        {shown.length === 0 ? (
          <p className="muted sqlsteps-none">{t('sqlSteps.problems.noMatch')}</p>
        ) : (
          shown.map((p, i) => {
            const step = p.step === undefined ? (outline.statements[p.statement] ? t(`sqlSteps.kind.${outline.statements[p.statement]!.kind}`) : '') : p.step || t('sqlSteps.main');
            const message = sqlProblemMessage(p);
            return (
              <button key={i} className="sqlsteps-problem" onClick={() => onJump(p.from, p.to)} title={message}>
                <SeverityIcon severity={p.severity} />
                <span className="sqlsteps-problem-body">
                  <span className="sqlsteps-problem-msg">{message}</span>
                  <span className="muted sqlsteps-problem-where">
                    <span className="sqlsteps-problem-step">{step}</span>
                    <span>{t('sqlSteps.problems.line', { line: lineOf(starts, p.from) })}</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function ParamList({ params, text, cursor, onJump, values, onValue }: { params: readonly SqlParam[]; text: string; cursor?: number; onJump(from: number, to?: number): void; values?: Record<number, string>; onValue?(n: number, value: string): void }) {
  const [selected, setSelected] = useState<number>();
  const starts = useMemo(() => lineStarts(text), [text]);
  if (params.length === 0) {
    return <PanelNotice icon={<Icon name="list-flat" size={20} />} title={t('sqlSteps.params.none')} message={t('sqlSteps.params.noneHint')} />;
  }
  const lineText = (line: number) => text.slice(starts[line - 1] ?? 0, starts[line] ?? text.length).trim();
  return (
    <div className="sqlsteps-list">
      {params.map((p) => {
        const open = selected === p.n;
        return (
          <div key={p.n} className="sqlsteps-param">
            <button
              className="sqlsteps-problem"
              aria-expanded={open}
              onClick={() => {
                setSelected(open ? undefined : p.n);
                const first = p.uses[0];
                const here = cursor !== undefined && p.uses.some((u) => lineOf(starts, u.from) === lineOf(starts, cursor));
                if (!open && first && !here) onJump(first.from, first.to);
              }}
            >
              <code className="sqlsteps-param-name">{`{${p.n}}`}</code>
              <span className="sqlsteps-problem-body">
                <span className="sqlsteps-problem-msg">{t('sqlSteps.params.uses', { count: p.count })}</span>
                <span className="muted sqlsteps-problem-where">
                  <span>{t('sqlSteps.params.guarded', { count: p.markers })}</span>
                  <span>{t('sqlSteps.params.unguarded', { count: p.unguarded })}</span>
                </span>
              </span>
            </button>
            {open && (
              <div className="sqlsteps-param-detail">
                {onValue && (
                  <input
                    className="input"
                    value={values?.[p.n] ?? ''}
                    onChange={(e) => onValue(p.n, e.target.value)}
                    placeholder={t('sqlSteps.params.value')}
                    aria-label={t('sqlSteps.params.valueOf', { n: p.n })}
                  />
                )}
                {p.uses.map((use, i) => {
                  const line = lineOf(starts, use.from);
                  return (
                    <button key={i} className="sqlsteps-param-use" onClick={() => onJump(use.from, use.to)} title={t(`sqlSteps.params.kind.${use.kind}`)}>
                      <span className="muted sqlsteps-param-line">{line}</span>
                      <code className="sqlsteps-code">{lineText(line)}</code>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function stepLabel(step: SqlStep): string {
  return step.name || t('sqlSteps.main');
}

function stepText(step: SqlStep): string {
  return [step.name, ...step.reads.map((r) => `${r.name} ${r.alias ?? ''}`), ...step.joins.map((j) => `${j.target} ${j.alias ?? ''}`)].join(' ').toLowerCase();
}

function groupTitle(s: SqlStatementOutline): string {
  const kind = t(`sqlSteps.kind.${s.kind}`);
  return s.target ? `${kind} ${s.target}` : kind;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sqlsteps-row">
      <span className="sqlsteps-label">{label}</span>
      <div className="sqlsteps-value">{children}</div>
    </div>
  );
}

function Items({ items }: { items: string[] }) {
  return <>{items.map((x, i) => <code key={i} className="sqlsteps-code" title={x}>{x}</code>)}</>;
}

/** Explains a SQL script as its CTE steps: what each reads, joins, filters and feeds. */
export function SqlSteps({ text, onJump, cursor, onClose, tab: tabProp, onTab, width, onWidth, bottom, paramValues, onParamValue }: SqlStepsProps) {
  const deferred = useDeferredValue(text);
  const outline = useMemo(() => sqlOutline(deferred), [deferred]);
  // Shared by every tab, so a tab switch or cursor move never recomputes them.
  const problems = useMemo(() => sqlLint(deferred, outline), [deferred, outline]);
  const params = useMemo(() => sqlParams(deferred), [deferred]);
  const worst = useMemo(() => worstSeverity(problems), [problems]);
  const stepProblems = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of problems) {
      if (p.step === undefined) continue;
      const key = `${p.statement}:${p.step}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [problems]);
  const [ownTab, setOwnTab] = useState<SqlStepsTab>('steps');
  const tab = tabProp ?? ownTab;
  const setTab = (next: SqlStepsTab) => {
    setOwnTab(next);
    onTab?.(next);
  };
  const [problemFilter, setProblemFilter] = useState<{ statement: number; step: string }>();
  const showStepProblems = (statement: number, step: string) => {
    setProblemFilter({ statement, step });
    setTab('problems');
  };

  const aside = useRef<HTMLElement>(null);
  const [ownWidth, setOwnWidth] = useState(DEFAULT_WIDTH);
  const [liveWidth, setLiveWidth] = useState<number>();
  const shownWidth = liveWidth ?? width ?? ownWidth;
  const clampWidth = (w: number) => {
    const parent = aside.current?.parentElement?.clientWidth ?? 0;
    const max = parent > 0 ? Math.max(MIN_WIDTH, parent * MAX_SHARE) : Infinity;
    return Math.round(Math.min(max, Math.max(MIN_WIDTH, w)));
  };
  const commitWidth = (w: number) => {
    setOwnWidth(w);
    setLiveWidth(undefined);
    onWidth?.(w);
  };
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = shownWidth;
    let last = startW;
    const move = (ev: globalThis.PointerEvent) => {
      last = clampWidth(startW + startX - ev.clientX);
      setLiveWidth(last);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      commitWidth(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const resizeKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowLeft' ? RESIZE_STEP : e.key === 'ArrowRight' ? -RESIZE_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    commitWidth(clampWidth(shownWidth + delta));
  };

  const [filter, setFilter] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();

  const counts = useMemo(() => {
    let ctes = 0;
    for (const s of outline.statements) ctes += s.steps.filter((x) => x.kind === 'cte').length;
    return { statements: outline.statements.length, ctes, tables: outline.tables.length };
  }, [outline]);

  const active = useMemo(() => {
    if (cursor === undefined) return undefined;
    let best: { key: string; size: number } | undefined;
    outline.statements.forEach((s, si) => {
      s.steps.forEach((step, i) => {
        if (cursor < step.from || cursor > step.to) return;
        const size = step.to - step.from;
        if (!best || size < best.size) best = { key: `${si}:${i}`, size };
      });
    });
    return best?.key;
  }, [outline, cursor]);

  const scrollTo = (key: string) => {
    const box = list.current;
    const card = box?.querySelector<HTMLElement>(`[data-step="${key}"]`);
    if (!box || !card) return;
    const top = card.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop || top + card.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - (box.clientHeight - card.offsetHeight) / 2;
    }
  };
  useEffect(() => {
    if (active) scrollTo(active);
  }, [active]);

  const jumpTo = (si: number, name: string) => {
    const statement = outline.statements[si];
    const index = statement?.steps.findIndex((x) => (name === MAIN ? x.kind === 'main' : x.name === name)) ?? -1;
    const step = statement?.steps[index];
    if (!step) return;
    setFilter('');
    window.setTimeout(() => scrollTo(`${si}:${index}`), 0);
    onJump(step.nameFrom ?? step.from, step.nameTo);
  };

  const groups = outline.statements
    .map((s, si) => ({ s, si, steps: s.steps.map((step, i) => ({ step, i })).filter(({ step }) => !q || stepText(step).includes(q)) }))
    .filter((g) => g.steps.length > 0);

  return (
    <aside className={`sqlsteps${bottom ? ' is-bottom' : ''}`} aria-label={t('sqlSteps.title')} ref={aside} style={bottom ? undefined : { width: shownWidth }}>
      {!bottom && <div
        className="sqlsteps-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sqlSteps.resize')}
        title={t('sqlSteps.resize')}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeKey}
      />}
      <div className="sqlsteps-head">
        <div className="sqlsteps-tabs" role="tablist">
          {TABS.map((id) => (
            <button key={id} role="tab" className="sqlsteps-tab" aria-selected={tab === id} onClick={() => { if (id === 'problems') setProblemFilter(undefined); setTab(id); }}>
              {t(`sqlSteps.tab.${id}`)}
              {id === 'params' && params.length > 0 && <span className="sqlsteps-count">{params.length}</span>}
              {id === 'problems' && problems.length > 0 && <span className={`sqlsteps-count is-${worst}`}>{problems.length}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {onClose && (
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} title={t('sqlSteps.close')} aria-label={t('sqlSteps.close')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {tab === 'graph' ? (
        <SqlGraph outline={outline} problems={problems} cursor={cursor} onJump={onJump} />
      ) : tab === 'params' ? (
        <ParamList params={params} text={deferred} cursor={cursor} onJump={onJump} values={paramValues} onValue={onParamValue} />
      ) : tab === 'problems' ? (
        <ProblemList problems={problems} text={deferred} outline={outline} filter={problemFilter} onClearFilter={() => setProblemFilter(undefined)} onJump={onJump} />
      ) : (
      <>
      <span className="muted sqlsteps-counts">{t('sqlSteps.counts', counts)}</span>
      {outline.statements.length > 0 && (
        <input className="sqlsteps-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sqlSteps.filter')} aria-label={t('sqlSteps.filter')} />
      )}
      <div className="sqlsteps-list" ref={list}>
        {outline.statements.length === 0 ? (
          <PanelNotice icon={<Icon name="list-flat" size={20} />} title={t('sqlSteps.empty')} message={t('sqlSteps.emptyHint')} />
        ) : groups.length === 0 ? (
          <p className="muted sqlsteps-none">{t('sqlSteps.noMatch')}</p>
        ) : (
          groups.map(({ s, si, steps }) => (
            <section key={si} className="sqlsteps-group">
              <button className="sqlsteps-group-head" onClick={() => onJump(s.from, s.to)} title={groupTitle(s)}>
                {groupTitle(s)}
              </button>
              {steps.map(({ step, i }) => {
                const key = `${si}:${i}`;
                const clickJump = () => onJump(step.nameFrom ?? step.from, step.nameTo);
                return (
                  <div
                    key={key}
                    data-step={key}
                    className={`sqlsteps-card${active === key ? ' is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={clickJump}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        clickJump();
                      }
                    }}
                  >
                    <div className="sqlsteps-name">
                      <span className="sqlsteps-name-text">{stepLabel(step)}</span>
                      {(stepProblems.get(`${si}:${step.name}`) ?? 0) > 0 && (
                        <button
                          className="sqlsteps-count is-step"
                          title={t('sqlSteps.stepProblems', { count: stepProblems.get(`${si}:${step.name}`)! })}
                          onClick={(e) => {
                            e.stopPropagation();
                            showStepProblems(si, step.name);
                          }}
                        >
                          {stepProblems.get(`${si}:${step.name}`)}
                        </button>
                      )}
                    </div>
                    {step.reads.length > 0 && (
                      <Row label={t('sqlSteps.reads')}>
                        {step.reads.map((r, k) => (
                          <code key={k} className={`sqlsteps-code${r.cte ? ' is-cte' : ''}`} title={r.alias ? `${r.name} ${r.alias}` : r.name}>{r.name}</code>
                        ))}
                      </Row>
                    )}
                    {step.joins.length > 0 && (
                      <Row label={t('sqlSteps.joins')}>
                        <div className="sqlsteps-joins">
                          {step.joins.map((j, k) => (
                            <div key={k} className="sqlsteps-join">
                              <Badge>{j.type}</Badge>
                              <code className="sqlsteps-code" title={j.target}>{j.target}</code>
                              {j.on && <code className="sqlsteps-on" title={j.on}>{t('sqlSteps.on')} {j.on}</code>}
                            </div>
                          ))}
                        </div>
                      </Row>
                    )}
                    {step.optional.length > 0 && (
                      <Row label={t('sqlSteps.optional')}>
                        {step.optional.map((n) => <code key={n} className="sqlsteps-code sqlsteps-optional">{`{${n}}`}</code>)}
                      </Row>
                    )}
                    {step.filters.length > 0 && <Row label={t('sqlSteps.filters')}><Items items={step.filters} /></Row>}
                    {(step.groupBy.length > 0 || step.aggregates.length > 0) && (
                      <Row label={t('sqlSteps.groupBy')}>
                        <Items items={step.groupBy} />
                        <Items items={step.aggregates} />
                      </Row>
                    )}
                    {step.having && <Row label={t('sqlSteps.having')}><Items items={[step.having]} /></Row>}
                    {(step.windows.length > 0 || step.dedupe) && (
                      <Row label={t('sqlSteps.windows')}>
                        {step.dedupe && <Badge tone="info">{t('sqlSteps.dedupe')}</Badge>}
                        <Items items={step.windows} />
                      </Row>
                    )}
                    {(step.distinct || step.setOps.length > 0 || step.orderBy.length > 0 || step.limit || step.subqueries > 0) && (
                      <div className="sqlsteps-badges">
                        {step.distinct && <Badge>{t('sqlSteps.distinct')}</Badge>}
                        {step.setOps.map((op, k) => <Badge key={k}>{op}</Badge>)}
                        {step.orderBy.length > 0 && <Badge title={step.orderBy.join(', ')}>{t('sqlSteps.orderBy')}</Badge>}
                        {step.limit && <Badge title={step.limit}>{t('sqlSteps.limit')}</Badge>}
                        {step.subqueries > 0 && <Badge>{t('sqlSteps.subqueries', { count: step.subqueries })}</Badge>}
                      </div>
                    )}
                    {step.feeds.length > 0 && (
                      <Row label={t('sqlSteps.feeds')}>
                        {step.feeds.map((name) => (
                          <button
                            key={name}
                            className="sqlsteps-feed"
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpTo(si, name);
                            }}
                          >
                            {name === MAIN ? t('sqlSteps.main') : name}
                          </button>
                        ))}
                      </Row>
                    )}
                    {step.kind === 'cte' && step.feeds.length === 0 && <div className="muted sqlsteps-unused">{t('sqlSteps.unused')}</div>}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
      </>
      )}
    </aside>
  );
}
