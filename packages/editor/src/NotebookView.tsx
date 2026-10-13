import { PanelBanner, t } from '@deckbuilder/ui';
import { useMemo } from 'react';
import { CodeView } from './CodeView';
import { MarkdownView } from './MarkdownView';

interface Output {
  output_type?: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface Cell {
  cell_type?: string;
  source?: string | string[];
  outputs?: Output[];
  execution_count?: number | null;
}

const join = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('') : v ?? '');
// Matches the ESC control character of ANSI color codes.
const ANSI = /\u001b\[[0-9;]*m/g;

function OutputView({ output }: { output: Output }) {
  if (output.output_type === 'error') {
    const trace = (output.traceback ?? []).join('\n').replace(ANSI, '') || `${output.ename}: ${output.evalue}`;
    return <pre className="nb-output nb-error">{trace}</pre>;
  }
  if (output.output_type === 'stream') return <pre className="nb-output">{join(output.text)}</pre>;
  const data = output.data ?? {};
  for (const type of ['image/png', 'image/jpeg', 'image/gif']) {
    if (data[type]) return <div className="nb-output"><img src={`data:${type};base64,${join(data[type]).replace(/\s/g, '')}`} alt="" /></div>;
  }
  if (data['text/plain']) return <pre className="nb-output">{join(data['text/plain'])}</pre>;
  return null;
}

/** A Jupyter notebook: markdown and code cells with their text and image outputs. */
export function NotebookView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      const nb = JSON.parse(text) as { cells?: Cell[]; metadata?: { language_info?: { name?: string } } };
      if (!Array.isArray(nb.cells)) return { error: 'cells' };
      return { cells: nb.cells };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [text]);

  if ('error' in parsed) return <PanelBanner tone="err">{t('preview.notebookInvalid', { message: parsed.error ?? '' })}</PanelBanner>;
  return (
    <div className="file-preview">
      <div className="file-preview-body nb">
        {parsed.cells.map((cell, i) => {
          const source = join(cell.source);
          if (cell.cell_type === 'markdown') return <div key={i} className="nb-cell nb-markdown"><MarkdownView markdown={source} /></div>;
          if (cell.cell_type === 'code') {
            return (
              <div key={i} className="nb-cell">
                <div className="nb-prompt">[{cell.execution_count ?? ' '}]</div>
                <div className="nb-code"><CodeView value={source} lang="python" wrap /></div>
                {(cell.outputs ?? []).map((o, j) => <OutputView key={j} output={o} />)}
              </div>
            );
          }
          return source ? <pre key={i} className="nb-cell nb-output">{source}</pre> : null;
        })}
      </div>
    </div>
  );
}
