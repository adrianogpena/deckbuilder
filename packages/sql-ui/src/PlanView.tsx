import { Button, copyText, IconButton, useToast } from '@deckbuilderkit/ui';
import { t } from './i18n';
import type { DbPlanRow } from './types';

const operationOf = (r: DbPlanRow) => (r.options ? `${r.operation} ${r.options}` : r.operation);
const objectOf = (r: DbPlanRow) => (r.objectName ? (r.objectOwner ? `${r.objectOwner}.${r.objectName}` : r.objectName) : '');
const num = (n: number | null) => (n === null ? '' : String(n));

/** The id of the step with the highest cost, leaving out the root (its cost is the total). */
export function costliestStep(rows: DbPlanRow[]): number | undefined {
  let best: DbPlanRow | undefined;
  for (const r of rows) {
    if (r.parentId === null || r.cost === null) continue;
    if (!best || r.cost > (best.cost ?? -1)) best = r;
  }
  return best?.id;
}

/** A fixed-width text plan in the style of DBMS_XPLAN, with the predicates below the table. */
export function planText(rows: DbPlanRow[]): string {
  const head = [t('workbench.plan.id'), t('workbench.plan.operation'), t('workbench.plan.object'), t('workbench.plan.rows'), t('workbench.plan.bytes'), t('workbench.plan.cost')];
  const body = rows.map((r) => [String(r.id), `${' '.repeat(r.depth)}${operationOf(r)}`, objectOf(r), num(r.cardinality), num(r.bytes), num(r.cost)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((cells) => cells[i].length)));
  const right = new Set([0, 3, 4, 5]);
  const line = (cells: string[]) => `| ${cells.map((c, i) => (right.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(' | ')} |`;
  const rule = `${'-'.repeat(widths.reduce((sum, w) => sum + w + 3, 1))}`;
  const out = [rule, line(head), rule, ...body.map(line), rule];
  const predicates = rows.flatMap((r) => [
    ...(r.accessPredicates ? [`${String(r.id).padStart(3)} - access(${r.accessPredicates})`] : []),
    ...(r.filterPredicates ? [`${String(r.id).padStart(3)} - filter(${r.filterPredicates})`] : []),
  ]);
  if (predicates.length > 0) out.push('', `${t('workbench.plan.predicates')}:`, ...predicates);
  return out.join('\n');
}

interface Props {
  rows: DbPlanRow[];
  onClose?: () => void;
}

/** An EXPLAIN PLAN as an indented tree, the costliest step marked. */
export function PlanView({ rows, onClose }: Props) {
  const toast = useToast();
  const hot = costliestStep(rows);
  const copy = async () => {
    const ok = await copyText(planText(rows));
    toast({ message: t(ok ? 'workbench.plan.copied' : 'workbench.log.copyFailed') });
  };
  return (
    <div className="wb-plan">
      <div className="row wb-plan-bar">
        <span className="mono-label">{t('workbench.plan.title')}</span>
        <Button title={t('workbench.plan.copy')} size="sm" icon="copy" onClick={copy} disabled={rows.length === 0}>
          {t('workbench.plan.copy')}
        </Button>
        {onClose && <IconButton icon="close" label={t('workbench.plan.close')} onClick={onClose} />}
      </div>
      {rows.length === 0 ? (
        <p className="muted wb-plan-empty">{t('workbench.plan.empty')}</p>
      ) : (
        <div className="wb-plan-scroll">
          <table className="wb-plan-table">
            <thead>
              <tr>
                <th className="num">{t('workbench.plan.id')}</th>
                <th>{t('workbench.plan.operation')}</th>
                <th>{t('workbench.plan.object')}</th>
                <th className="num">{t('workbench.plan.rows')}</th>
                <th className="num">{t('workbench.plan.bytes')}</th>
                <th className="num">{t('workbench.plan.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const predicates = [r.accessPredicates && `access(${r.accessPredicates})`, r.filterPredicates && `filter(${r.filterPredicates})`].filter(Boolean).join('\n');
                return (
                  <tr key={r.id} className={r.id === hot ? 'wb-plan-hot' : undefined} title={r.id === hot ? [t('workbench.plan.costliest'), predicates].filter(Boolean).join('\n') : predicates || undefined}>
                    <td className="num">{r.id}</td>
                    <td style={{ paddingLeft: 6 + r.depth * 16 }}>
                      {operationOf(r)}
                      {predicates && <span className="wb-plan-pred"> *</span>}
                    </td>
                    <td>{objectOf(r)}</td>
                    <td className="num">{num(r.cardinality)}</td>
                    <td className="num">{num(r.bytes)}</td>
                    <td className="num">{num(r.cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
