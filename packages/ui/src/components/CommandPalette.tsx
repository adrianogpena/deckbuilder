import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { GLOBAL, type CommandDef } from '../keybindings';
import { fuzzyPath, highlightRuns } from '../fuzzy';
import { filterPalette, type PaletteItem } from '../palette';
import { type QuickOpenFile, useQuickOpenSource } from '../quick-open';
import { useCommand } from './Keybindings';
import { useModalOpen } from './ui';

const PAGE = 8;
const LIMIT = 60;

interface FileRow {
  file: QuickOpenFile;
  positions: number[];
}

/** Files best first; an empty query lists the recent ones, then the rest by path. */
function rankFiles(files: readonly QuickOpenFile[], recent: readonly string[], query: string): FileRow[] {
  if (!query.trim()) {
    const byId = new Map(files.map((f) => [f.id, f]));
    const first = recent.flatMap((id) => byId.get(id) ?? []);
    const seen = new Set(first.map((f) => f.id));
    const rest = files.filter((f) => !seen.has(f.id)).sort((a, b) => a.path.localeCompare(b.path));
    return [...first, ...rest].slice(0, LIMIT).map((file) => ({ file, positions: [] }));
  }
  const rows: Array<FileRow & { score: number }> = [];
  for (const file of files) {
    const m = fuzzyPath(query, file.path);
    if (m) rows.push({ file, positions: m.positions, score: m.score });
  }
  return rows.sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length).slice(0, LIMIT);
}

function Highlighted({ text, positions, offset = 0 }: { text: string; positions: number[]; offset?: number }) {
  const local = positions.filter((p) => p >= offset && p < offset + text.length).map((p) => p - offset);
  return (
    <>
      {highlightRuns(text, local).map((r, i) => (r.hit ? <b key={i} className="pal-match">{r.text}</b> : r.text))}
    </>
  );
}

/**
 * One box for files and commands. With a quick-open source (the Explorer's) it lists files; typing
 * `>` first switches to commands. Without one it lists commands only.
 */
export function CommandPalette({ items, onClose, initialQuery = '' }: { items: PaletteItem[]; onClose: () => void; initialQuery?: string }) {
  const source = useQuickOpenSource();
  const [query, setQuery] = useState(initialQuery);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useModalOpen();

  useEffect(() => {
    input.current?.focus();
    source?.onOpen?.();
  }, []);

  const fileMode = !!source && !query.startsWith('>');
  const results = useMemo(() => filterPalette(items, query.replace(/^>\s*/, '')), [items, query]);
  const fileRows = useMemo(() => (fileMode ? rankFiles(source!.files, source!.recent, query) : []), [fileMode, source, query]);
  const count = fileMode ? fileRows.length : results.length;

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const last = count - 1;
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const chooseFile = (row: FileRow | undefined, side: boolean) => {
    if (!row || !source) return;
    onClose();
    source.open(row.file, side);
  };
  const move = (e: React.KeyboardEvent, to: (i: number) => number) => {
    e.preventDefault();
    setIndex((i) => Math.max(0, Math.min(last, to(i))));
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true">
        <div className="pal-input">
          <span className="pal-key">{fileMode ? '/' : source ? '>' : ':'}</span>
          <input
            ref={input}
            value={query}
            placeholder={source ? t('palette.placeholderFiles') : t('palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Keeps a Modal under the palette open.
                e.preventDefault();
                onClose();
              }
              else if (e.key === 'ArrowDown') move(e, (i) => i + 1);
              else if (e.key === 'ArrowUp') move(e, (i) => i - 1);
              else if (e.key === 'PageDown') move(e, (i) => i + PAGE);
              else if (e.key === 'PageUp') move(e, (i) => i - PAGE);
              else if (e.key === 'Home') move(e, () => 0);
              else if (e.key === 'End') move(e, () => last);
              else if (e.key === 'Enter') {
                if (fileMode) chooseFile(fileRows[index], e.ctrlKey || e.metaKey);
                else choose(results[index]);
              }
            }}
          />
        </div>
        <div className="pal-list" ref={list}>
          {count === 0 && <div className="pal-empty">{fileMode && source!.loading ? t('palette.loadingFiles') : t('palette.empty')}</div>}
          {fileMode && fileRows.map((row, i) => {
            const at = row.file.path.lastIndexOf('/') + 1;
            return (
              <button title={row.file.path}
                key={row.file.id}
                className={`pal-item${i === index ? ' active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={(e) => chooseFile(row, e.ctrlKey || e.metaKey)}
              >
                <span className="pal-label">
                  <Highlighted text={row.file.path.slice(at)} positions={row.positions} offset={at} />
                  {at > 0 && <span className="pal-dir"><Highlighted text={row.file.path.slice(0, at - 1)} positions={row.positions} /></span>}
                </span>
                {row.file.project && <span className="pal-hint">{row.file.project}</span>}
              </button>
            );
          })}
          {!fileMode && results.map((item, i) => (
            <button title={item.label}
              key={item.id}
              className={`pal-item${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              <span className="pal-group">{item.group}</span>
              <span className="pal-label">{item.label}</span>
              {item.hint && <span className="pal-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd>{t('palette.navigate')}</span>
          <span><kbd>enter</kbd>{t('palette.open')}</span>
          {fileMode && <span><kbd>ctrl+enter</kbd>{t('palette.side')}</span>}
          <span><kbd>esc</kbd>{t('palette.close')}</span>
        </div>
      </div>
    </div>
  );
}

/** Ctrl+Shift+P and F1 toggle the palette on commands (a `>` typed), also while typing and while it is open. */
export function paletteCommand(): CommandDef {
  return { id: 'palette.toggle', scope: GLOBAL, label: t('keys.palette'), keys: ['Ctrl+Shift+P', 'F1'], inInput: true, inModal: true };
}

/** Ctrl+P opens the palette on files (on commands when the screen offers no files). */
export function quickOpenCommand(): CommandDef {
  return { id: 'palette.quickOpen', scope: GLOBAL, label: t('keys.quickOpen'), keys: ['Ctrl+P'], inInput: true, inModal: true };
}

/** Open state for the palette, toggled by `paletteCommand()` and `quickOpenCommand()`; `initialQuery` is what the box starts with. */
export function useCommandPalette(): { open: boolean; setOpen: (open: boolean) => void; initialQuery: string } {
  const [state, setState] = useState({ open: false, initialQuery: '' });
  const setOpen = (open: boolean) => setState({ open, initialQuery: '>' });
  useCommand(paletteCommand(), () => setState((s) => ({ open: !s.open, initialQuery: '>' })));
  useCommand(quickOpenCommand(), () => setState((s) => (s.open && s.initialQuery === '' ? { open: false, initialQuery: '' } : { open: true, initialQuery: '' })));
  return { open: state.open, setOpen, initialQuery: state.initialQuery };
}
