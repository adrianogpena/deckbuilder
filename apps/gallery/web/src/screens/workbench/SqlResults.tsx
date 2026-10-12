import { DataTable, OutputPanel, SplitView } from '@deckbuilder/ui';
import { type useSqlRunner } from './useSqlRunner';

export const DEFAULT_RESULTS: [number, number] = [0.65, 0.35];

type Runner = ReturnType<typeof useSqlRunner>;

interface Props {
  runner: Pick<Runner, 'shown' | 'cols' | 'tableRows' | 'selection' | 'setSelection' | 'lines' | 'clearLog'>;
  sizes: [number, number];
  onSizes: (sizes: [number, number]) => void;
  widths?: Record<string, number>;
  onWidths?: (widths: Record<string, number>) => void;
}

/** The result table beside the output log. Column widths are only passed for the demo rows; database results size per run. */
export function SqlResults({ runner, sizes, onSizes, widths, onWidths }: Props) {
  const { shown, cols, tableRows, selection, setSelection, lines, clearLog } = runner;
  return (
    <SplitView direction="row" sizes={sizes} defaultSizes={DEFAULT_RESULTS} onResize={(s) => onSizes([s[0], s[1]])}>
      <div key="table" className="wb-pane">
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
      </div>
      <div key="output" className="wb-pane">
        <OutputPanel lines={lines} onClear={clearLog} />
      </div>
    </SplitView>
  );
}
