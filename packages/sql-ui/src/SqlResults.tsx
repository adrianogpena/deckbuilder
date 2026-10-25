import { DataTable, OutputPanel, SplitView } from '@kedalion/ui';
import { PlanView } from './PlanView';
import { type useSqlRunner } from './useSqlRunner';

export const DEFAULT_RESULTS: [number, number] = [0.65, 0.35];

type Runner = ReturnType<typeof useSqlRunner>;

interface Props {
  runner: Pick<Runner, 'shown' | 'cols' | 'tableRows' | 'selection' | 'setSelection' | 'lines' | 'clearLog'> & Partial<Pick<Runner, 'plan' | 'closePlan'>>;
  sizes: [number, number];
  onSizes: (sizes: [number, number]) => void;
  widths?: Record<string, number>;
  onWidths?: (widths: Record<string, number>) => void;
}

/** The result table (or the latest execution plan) beside the output log. Column widths are only passed for the demo rows; database results size per run. */
export function SqlResults({ runner, sizes, onSizes, widths, onWidths }: Props) {
  const { shown, cols, tableRows, selection, setSelection, lines, clearLog, plan, closePlan } = runner;
  return (
    <SplitView direction="row" sizes={sizes} defaultSizes={DEFAULT_RESULTS} onResize={(s) => onSizes([s[0], s[1]])}>
      <div key="table" className="wb-pane">
        {plan ? (
          <PlanView rows={plan} onClose={closePlan} />
        ) : (
          <DataTable
            key={shown.kind === 'db' ? shown.run : 'demo'}
            columns={cols}
            rows={tableRows}
            rowKey={(r) => r.key}
            selection={selection}
            onSelectionChange={setSelection}
            widths={widths}
            onWidthsChange={onWidths}
          />
        )}
      </div>
      <div key="output" className="wb-pane">
        <OutputPanel lines={lines} onClear={clearLog} />
      </div>
    </SplitView>
  );
}
