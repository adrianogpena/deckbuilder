import './tables.css';
import { ContextMenu, type ContextMenuItem, createT } from '@deckbuilderkit/ui';
import { type CmdKey, commandsCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand, insertTableCommand } from '@milkdown/preset-gfm';
import { keymap } from '@milkdown/prose/keymap';
import type { EditorState, Transaction } from '@milkdown/prose/state';
import { deleteColumn, deleteRow, deleteTable, goToNextCell, isInTable, selectedRect } from '@milkdown/prose/tables';
import type { EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { createElement, useEffect, useState } from 'react';
import type { RichApi, RichFeature } from './commands';

type TableKey =
  | 'explorer.md.table.rowAbove' | 'explorer.md.table.rowBelow' | 'explorer.md.table.colLeft' | 'explorer.md.table.colRight'
  | 'explorer.md.table.deleteRow' | 'explorer.md.table.deleteColumn' | 'explorer.md.table.deleteTable'
  | 'explorer.md.table.alignLeft' | 'explorer.md.table.alignCenter' | 'explorer.md.table.alignRight';

/** Labels registered by the host (view-explorer i18n). */
const t = createT<TableKey>();

export type TableAlign = 'left' | 'center' | 'right';

type Cmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Sets the alignment of every cell in the selected columns; markdown keeps one alignment per column. */
export function setColumnAlign(align: TableAlign): Cmd {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const rect = selectedRect(state);
      const tr = state.tr;
      for (const pos of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height })) {
        const at = rect.tableStart + pos;
        const cell = tr.doc.nodeAt(at);
        if (cell && cell.attrs.alignment !== align) tr.setNodeMarkup(at, null, { ...cell.attrs, alignment: align });
      }
      dispatch(tr);
    }
    return true;
  };
}

/** The alignment of the column holding the cursor, null outside a table. */
export function columnAlign(state: EditorState): TableAlign | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const cell = state.doc.nodeAt(rect.tableStart + rect.map.map[rect.left]!);
  return (cell?.attrs.alignment as TableAlign | null) ?? 'left';
}

function call<T>(ctx: Ctx, key: CmdKey<T>, payload?: T): boolean {
  return ctx.get(commandsCtx).call(key, payload);
}

/** Tab moves to the next cell and adds a row past the last one; Shift+Tab moves back. */
const cellKeys = $prose((ctx) => keymap({
  Tab: (state, dispatch, view) => {
    if (!isInTable(state)) return false;
    if (goToNextCell(1)(state, dispatch)) return true;
    if (!call(ctx, addRowAfterCommand.key)) return false;
    return view ? goToNextCell(1)(view.state, view.dispatch) : true;
  },
  'Shift-Tab': (state, dispatch) => {
    if (!isInTable(state)) return false;
    goToNextCell(-1)(state, dispatch);
    return true;
  },
}));

/** Opens the actions menu of a view; set while its overlay is mounted. */
const openers = new WeakMap<EditorView, (at: { x: number; y: number }) => void>();

function inTable(api: RichApi): boolean {
  return isInTable(api.view.state);
}

function runIn(api: RichApi, fn: () => boolean): boolean {
  if (!inTable(api)) return false;
  fn();
  api.view.focus();
  return true;
}

function TableMenu({ api }: { api: RichApi }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    openers.set(api.view, setAt);
    return () => {
      openers.delete(api.view);
    };
  }, [api.view]);
  if (!at) return null;
  const { view, ctx } = api;
  const close = () => {
    setAt(null);
    view.focus();
  };
  const prose = (cmd: Cmd) => () => {
    cmd(view.state, view.dispatch);
  };
  const align = columnAlign(view.state);
  const alignItem = (a: TableAlign, key: TableKey): ContextMenuItem => ({ id: `align-${a}`, label: t(key), radio: true, checked: align === a, run: prose(setColumnAlign(a)) });
  const items: Array<ContextMenuItem | 'sep'> = [
    { id: 'row-above', label: t('explorer.md.table.rowAbove'), run: () => void call(ctx, addRowBeforeCommand.key) },
    { id: 'row-below', label: t('explorer.md.table.rowBelow'), run: () => void call(ctx, addRowAfterCommand.key) },
    { id: 'col-left', label: t('explorer.md.table.colLeft'), run: () => void call(ctx, addColBeforeCommand.key) },
    { id: 'col-right', label: t('explorer.md.table.colRight'), run: () => void call(ctx, addColAfterCommand.key) },
    'sep',
    alignItem('left', 'explorer.md.table.alignLeft'),
    alignItem('center', 'explorer.md.table.alignCenter'),
    alignItem('right', 'explorer.md.table.alignRight'),
    'sep',
    { id: 'delete-row', label: t('explorer.md.table.deleteRow'), danger: true, run: prose(deleteRow) },
    { id: 'delete-column', label: t('explorer.md.table.deleteColumn'), danger: true, run: prose(deleteColumn) },
    { id: 'delete-table', label: t('explorer.md.table.deleteTable'), danger: true, run: prose(deleteTable) },
  ];
  return createElement(ContextMenu, { at, items, onClose: close });
}

/** Tables: insert, edit, rows, columns, actions menu. */
export const tablesFeature: RichFeature = {
  plugins: [cellKeys],
  handlers: {
    insertTable: (api) => {
      call(api.ctx, insertTableCommand.key, { row: 3, col: 3 });
      api.view.focus();
      return true;
    },
    addTableRow: (api) => runIn(api, () => call(api.ctx, addRowAfterCommand.key)),
    addTableColumn: (api) => runIn(api, () => call(api.ctx, addColAfterCommand.key)),
    tableActions: (api) => {
      const open = openers.get(api.view);
      if (!open || !inTable(api)) return false;
      const c = api.view.coordsAtPos(api.view.state.selection.head);
      open({ x: c.left, y: c.bottom + 2 });
      return true;
    },
  },
  Overlay: TableMenu,
};
