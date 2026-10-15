import { Badge, Icon, PanelNotice, t } from '@deckbuilder/ui';
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { type SqlStatementOutline, type SqlStep, sqlOutline } from './sql/outline';

export interface SqlStepsProps {
  text: string;
  onJump(from: number, to?: number): void;
  /** Offset of the editor cursor; the card holding it is highlighted. */
  cursor?: number;
  onClose?(): void;
}

const MAIN = 'main';

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
export function SqlSteps({ text, onJump, cursor, onClose }: SqlStepsProps) {
  const deferred = useDeferredValue(text);
  const outline = useMemo(() => sqlOutline(deferred), [deferred]);
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
    <aside className="sqlsteps" aria-label={t('sqlSteps.title')}>
      <div className="sqlsteps-head">
        <strong>{t('sqlSteps.title')}</strong>
        <span className="muted sqlsteps-counts">{t('sqlSteps.counts', counts)}</span>
        <span className="spacer" />
        {onClose && (
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} title={t('sqlSteps.close')} aria-label={t('sqlSteps.close')}>
            <Icon name="close" />
          </button>
        )}
      </div>
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
                    <div className="sqlsteps-name">{stepLabel(step)}</div>
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
    </aside>
  );
}
