import { expect, test } from 'bun:test';
import { createFileUndo, MAX_UNDO, type UndoOp } from './file-undo';

const op = (n: number): UndoOp => ({ kind: 'create', project: 'p', paths: [`f${n}`] });

test('keeps the newest ops, drops the oldest past the limit', () => {
  const undo = createFileUndo();
  const ops = Array.from({ length: MAX_UNDO + 1 }, (_, i) => op(i));
  for (const o of ops) undo.push(o);
  expect(undo.last()).toBe(ops.at(-1));
  expect(undo.take(ops[0]!)).toBe(false);
  expect(undo.take(ops[1]!)).toBe(true);
});

test('take removes an op once', () => {
  const undo = createFileUndo();
  const a = op(1);
  const b = op(2);
  undo.push(a);
  undo.push(b);
  expect(undo.take(b)).toBe(true);
  expect(undo.take(b)).toBe(false);
  expect(undo.last()).toBe(a);
});
