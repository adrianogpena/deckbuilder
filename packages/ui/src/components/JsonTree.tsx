import { useState } from 'react';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { pathOf } from '../json-path';
import { Icon } from './ui';

const PAGE = 200;
const LONG_STRING = 200;

type Segment = string | number;

/** Collapsible view of parsed JSON; hover a row to copy its value or JSONPath. */
export function JsonTree({ value, initialDepth = 1, onCopyPath }: { value: unknown; initialDepth?: number; onCopyPath?(path: string): void }) {
  return (
    <div className="json-tree">
      <JsonNode label={null} value={value} path={[]} depth={0} initialDepth={initialDepth} onCopyPath={onCopyPath} />
    </div>
  );
}

interface NodeProps {
  label: Segment | null;
  value: unknown;
  path: Segment[];
  depth: number;
  initialDepth: number;
  onCopyPath?(path: string): void;
}

const isContainer = (v: unknown): v is object => typeof v === 'object' && v !== null;

function JsonNode({ label, value, path, depth, initialDepth, onCopyPath }: NodeProps) {
  const [open, setOpen] = useState(depth < initialDepth);
  const [shown, setShown] = useState(PAGE);
  const container = isContainer(value);
  const entries: Array<[Segment, unknown]> = !container
    ? []
    : Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const indent = { paddingLeft: depth * 16 };

  return (
    <>
      <div className="json-row" style={indent}>
        {container ? (
          <button className={open ? 'json-toggle open' : 'json-toggle'} onClick={() => setOpen(!open)} aria-expanded={open}>
            <Icon name="chevron" size={12} />
          </button>
        ) : (
          <span className="json-toggle" />
        )}
        {label !== null && <span className={typeof label === 'number' ? 'json-index' : 'json-key'}>{label}</span>}
        {label !== null && <span className="json-colon">:</span>}
        {container ? (
          <span className="json-count" onClick={() => setOpen(!open)}>
            {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
          </span>
        ) : (
          <JsonValue value={value} />
        )}
        <span className="json-actions">
          <button
            className="btn btn-ghost btn-sm"
            title={t('json.copyValue')}
            onClick={() => copyText(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value))}
          >
            <Icon name="copy" size={12} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title={t('json.copyPath')}
            onClick={async () => {
              const p = pathOf(path);
              if (await copyText(p)) onCopyPath?.(p);
            }}
          >
            $
          </button>
        </span>
      </div>
      {open && entries.slice(0, shown).map(([k, v]) => (
        <JsonNode key={k} label={k} value={v} path={[...path, k]} depth={depth + 1} initialDepth={initialDepth} onCopyPath={onCopyPath} />
      ))}
      {open && entries.length > shown && (
        <div className="json-row" style={{ paddingLeft: (depth + 1) * 16 }}>
          <span className="json-toggle" />
          <button className="btn btn-ghost btn-sm" onClick={() => setShown(shown + PAGE)}>
            {t('json.showMore', { n: Math.min(PAGE, entries.length - shown), total: entries.length - shown })}
          </button>
        </div>
      )}
    </>
  );
}

function JsonValue({ value }: { value: unknown }) {
  const [full, setFull] = useState(false);
  if (typeof value === 'string') {
    const cut = !full && value.length > LONG_STRING;
    return (
      <span className="json-str">
        "{cut ? value.slice(0, LONG_STRING) : value}{cut ? '…' : ''}"
        {cut && <button className="json-more" onClick={() => setFull(true)}>{t('json.more')}</button>}
      </span>
    );
  }
  if (typeof value === 'number') return <span className="json-num">{String(value)}</span>;
  return <span className="json-bool">{String(value)}</span>;
}
