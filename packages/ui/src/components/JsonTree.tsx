import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { pathOf } from '../json-path';
import { Button, IconButton } from './Button';
import { Icon } from './ui';

const PAGE = 200;
const LONG_STRING = 200;
const MAX_MATCHES = 5000;

type Segment = string | number;
type Command = { kind: 'all' | 'none' | 'search' | null; version: number };

interface TreeState {
  query: string;
  ancestors: Set<string>;
  current: string | null;
  command: Command;
}

const NO_STATE: TreeState = { query: '', ancestors: new Set(), current: null, command: { kind: null, version: 0 } };
const TreeContext = createContext<TreeState>(NO_STATE);

const keyOf = (path: Segment[]) => JSON.stringify(path);
const isContainer = (v: unknown): v is object => typeof v === 'object' && v !== null;
const entriesOf = (value: unknown): Array<[Segment, unknown]> =>
  !isContainer(value) ? [] : Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
const rowMatches = (label: Segment | null, value: unknown, q: string) =>
  (label !== null && String(label).toLowerCase().includes(q)) || (!isContainer(value) && String(value).toLowerCase().includes(q));

/** Rows (as path keys, in document order) whose key or value contains `q`, and every row above them. */
function findMatches(root: unknown, q: string) {
  const matches: string[] = [];
  const ancestors = new Set<string>();
  const walk = (label: Segment | null, value: unknown, path: Segment[]): boolean => {
    const before = matches.length;
    if (rowMatches(label, value, q) && before < MAX_MATCHES) matches.push(keyOf(path));
    const own = matches.length > before;
    let below = false;
    for (const [k, v] of entriesOf(value)) {
      if (matches.length >= MAX_MATCHES) break;
      if (walk(k, v, [...path, k])) below = true;
    }
    if (below) ancestors.add(keyOf(path));
    return own || below;
  };
  walk(null, root, []);
  return { matches, ancestors };
}

/** Collapsible view of parsed JSON with search and expand/collapse all; hover a row to copy its value or JSONPath. */
export function JsonTree({ value, initialDepth = 1, onCopyPath }: { value: unknown; initialDepth?: number; onCopyPath?(path: string): void }) {
  const [input, setInput] = useState('');
  const [index, setIndex] = useState(0);
  const [command, setCommand] = useState<Command>({ kind: null, version: 0 });
  const field = useRef<HTMLInputElement>(null);
  const q = input.trim().toLowerCase();
  const found = useMemo(() => (q ? findMatches(value, q) : { matches: [] as string[], ancestors: new Set<string>() }), [value, q]);
  const at = found.matches.length ? Math.min(index, found.matches.length - 1) : -1;

  const issue = (kind: 'all' | 'none' | 'search') => setCommand((c) => ({ kind, version: c.version + 1 }));
  useEffect(() => {
    setIndex(0);
    if (q) issue('search');
    else setCommand((c) => (c.kind === 'search' ? { kind: null, version: c.version + 1 } : c));
  }, [q, value]);

  const step = (d: number) => {
    if (!found.matches.length) return;
    setIndex((at + d + found.matches.length) % found.matches.length);
    issue('search');
  };

  const state = useMemo<TreeState>(
    () => ({ query: q, ancestors: found.ancestors, current: at >= 0 ? found.matches[at]! : null, command }),
    [q, found, at, command],
  );

  return (
    <div
      className="json-tree"
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          field.current?.focus();
          field.current?.select();
        }
      }}
    >
      <div className="json-bar">
        <IconButton
          icon={command.kind === 'none' ? 'chevron-down' : 'chevron-up'}
          label={t(command.kind === 'none' ? 'json.expandAll' : 'json.collapseAll')}
          onClick={() => issue(command.kind === 'none' ? 'all' : 'none')}
        />
        <span className="spacer" />
        <Icon name="search" size={13} />
        <input
          ref={field}
          className="json-search"
          value={input}
          placeholder={t('json.search')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') setInput('');
          }}
        />
        {q && <span className="json-hits">{found.matches.length ? `${at + 1}/${found.matches.length}${found.matches.length >= MAX_MATCHES ? '+' : ''}` : t('json.noMatches')}</span>}
        <IconButton icon="chevron-up" label={t('json.prevMatch')} onClick={() => step(-1)} disabled={!found.matches.length} />
        <IconButton icon="chevron-down" label={t('json.nextMatch')} onClick={() => step(1)} disabled={!found.matches.length} />
      </div>
      <TreeContext.Provider value={state}>
        <JsonNode label={null} value={value} path={[]} depth={0} initialDepth={initialDepth} onCopyPath={onCopyPath} />
      </TreeContext.Provider>
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

function Mark({ text }: { text: string }) {
  const { query } = useContext(TreeContext);
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: Array<string | { hit: string }> = [];
  let from = 0;
  for (let i = lower.indexOf(query); i >= 0; i = lower.indexOf(query, from)) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push({ hit: text.slice(i, i + query.length) });
    from = i + query.length;
  }
  if (!parts.length) return <>{text}</>;
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <mark key={i} className="json-mark">{p.hit}</mark>))}</>;
}

function JsonNode({ label, value, path, depth, initialDepth, onCopyPath }: NodeProps) {
  const tree = useContext(TreeContext);
  const key = keyOf(path);
  const container = isContainer(value);
  const entries = entriesOf(value);
  const wanted = (cmd: Command) =>
    cmd.kind === 'all' ? true : cmd.kind === 'none' ? depth === 0 : cmd.kind === 'search' ? tree.ancestors.has(key) : null;
  const [open, setOpen] = useState(() => wanted(tree.command) ?? depth < initialDepth);
  const [shown, setShown] = useState(PAGE);
  const row = useRef<HTMLDivElement>(null);
  const indent = { paddingLeft: depth * 16 };

  useEffect(() => {
    const next = wanted(tree.command);
    if (next === null) return;
    if (tree.command.kind === 'search') {
      if (!next) return;
      setOpen(true);
      let last = -1;
      entries.forEach(([k], i) => {
        const child = keyOf([...path, k]);
        if (tree.ancestors.has(child) || child === tree.current) last = i;
      });
      if (last >= 0) setShown((s) => Math.max(s, last + 1));
    } else setOpen(next);
  }, [tree.command.version]);

  const isCurrent = tree.current === key;
  useEffect(() => {
    if (isCurrent) row.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent, tree.command.version]);

  return (
    <>
      <div ref={row} className={isCurrent ? 'json-row current' : 'json-row'} style={indent}>
        {container ? (
          <button title={open ? t('json.collapse') : t('json.expand')} className={open ? 'json-toggle open' : 'json-toggle'} onClick={() => setOpen(!open)} aria-expanded={open}>
            <Icon name="chevron" size={12} />
          </button>
        ) : (
          <span className="json-toggle" />
        )}
        {label !== null && <span className={typeof label === 'number' ? 'json-index' : 'json-key'}><Mark text={String(label)} /></span>}
        {label !== null && <span className="json-colon">:</span>}
        {container ? (
          <span className="json-count" onClick={() => setOpen(!open)}>
            {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
          </span>
        ) : (
          <JsonValue value={value} />
        )}
        <span className="json-actions">
          <IconButton
            size="xs"
            icon="copy"
            label={t('json.copyValue')}
            onClick={() => copyText(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value))}
          />
          <Button
            variant="ghost"
            size="xs"
            title={t('json.copyPath')}
            aria-label={t('json.copyPath')}
            onClick={async () => {
              const p = pathOf(path);
              if (await copyText(p)) onCopyPath?.(p);
            }}
          >
            $
          </Button>
        </span>
      </div>
      {open && entries.slice(0, shown).map(([k, v]) => (
        <JsonNode key={k} label={k} value={v} path={[...path, k]} depth={depth + 1} initialDepth={initialDepth} onCopyPath={onCopyPath} />
      ))}
      {open && entries.length > shown && (
        <div className="json-row" style={{ paddingLeft: (depth + 1) * 16 }}>
          <span className="json-toggle" />
          <Button variant="ghost" size="xs" title={t('json.showMore', { n: Math.min(PAGE, entries.length - shown), total: entries.length - shown })} onClick={() => setShown(shown + PAGE)}>
            {t('json.showMore', { n: Math.min(PAGE, entries.length - shown), total: entries.length - shown })}
          </Button>
        </div>
      )}
    </>
  );
}

function JsonValue({ value }: { value: unknown }) {
  const { query } = useContext(TreeContext);
  const [full, setFull] = useState(false);
  if (typeof value === 'string') {
    const cut = !full && value.length > LONG_STRING && !(query && value.toLowerCase().includes(query));
    return (
      <span className="json-str">
        "<Mark text={cut ? value.slice(0, LONG_STRING) : value} />{cut ? '…' : ''}"
        {cut && <button title={t('json.more')} className="json-more" onClick={() => setFull(true)}>{t('json.more')}</button>}
      </span>
    );
  }
  if (typeof value === 'number') return <span className="json-num"><Mark text={String(value)} /></span>;
  return <span className="json-bool"><Mark text={String(value)} /></span>;
}
