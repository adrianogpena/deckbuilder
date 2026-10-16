import { useRef } from 'react';

/** One undoable file operation. Delete is not here: the Recycle Bin restores it. */
export type UndoOp =
  | { kind: 'create' | 'copy'; project: string; paths: string[] }
  | { kind: 'rename' | 'move'; project: string; moves: Array<{ from: string; to: string }> };

export const MAX_UNDO = 20;

export interface FileUndo {
  push(op: UndoOp): void;
  /** The newest op. */
  last(): UndoOp | undefined;
  /** Removes `op` wherever it sits; false when it is already gone. */
  take(op: UndoOp): boolean;
}

/** Stack of the last file operations of this Explorer session, newest last. */
export function createFileUndo(): FileUndo {
  const stack: UndoOp[] = [];
  return {
    push: (op) => {
      stack.push(op);
      if (stack.length > MAX_UNDO) stack.shift();
    },
    last: () => stack.at(-1),
    take: (op) => {
      const at = stack.indexOf(op);
      if (at < 0) return false;
      stack.splice(at, 1);
      return true;
    },
  };
}

export const useFileUndo = (): FileUndo => (useRef<FileUndo>().current ??= createFileUndo());
