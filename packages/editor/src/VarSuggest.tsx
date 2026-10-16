import type { RestEnvVar } from '@deckbuilderkit/server-core/protocol';
import { type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { filterVariableOptions, insertVariable, type VariableOption, variableOptions, variableQueryAt } from './variables';

export interface VarSuggest {
  /** Re-reads the text before the caret; call on change, select and click. */
  update(el: HTMLInputElement): void;
  /** Handles ↑/↓/Enter/Tab/Esc while the list is open; true when it took the key. */
  keyDown(e: KeyboardEvent<HTMLInputElement>): boolean;
  close(): void;
  /** The dropdown, or null when closed; render it inside a positioned wrapper. */
  list: ReactNode;
}

interface Open {
  caret: number;
  items: VariableOption[];
  index: number;
}

/** A `{{name}}` suggestion list for a plain input; without `variables` it never opens. */
export function useVarSuggest(variables: readonly RestEnvVar[] | undefined, input: RefObject<HTMLInputElement | null>, onChange: (value: string) => void): VarSuggest {
  const options = useMemo(() => (variables ? variableOptions(variables) : []), [variables]);
  const [open, setOpen] = useState<Open | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const el = input.current;
    if (pendingCaret.current !== null && el) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  });

  const close = () => setOpen(null);
  const update = (el: HTMLInputElement) => {
    if (!variables || el.selectionStart === null || el.selectionStart !== el.selectionEnd) return close();
    const q = variableQueryAt(el.value, el.selectionStart);
    const items = q ? filterVariableOptions(options, q.partial) : [];
    if (items.length === 0) return close();
    setOpen((prev) => ({ caret: el.selectionStart!, items, index: prev && prev.index < items.length ? prev.index : 0 }));
  };
  const pick = (name: string) => {
    const el = input.current;
    if (!el || !open) return;
    const r = insertVariable(el.value, open.caret, name);
    pendingCaret.current = r.caret;
    setOpen(null);
    onChange(r.text);
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return false;
    const n = open.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      setOpen({ ...open, index: (open.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      pick(open.items[open.index]!.name);
    } else if (e.key === 'Escape') {
      close();
    } else {
      return false;
    }
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
  const list = open && (
    <ul ref={listRef} className="menu var-suggest" role="listbox">
      {open.items.map((o, i) => (
        <li
          key={o.name}
          role="option"
          aria-selected={i === open.index}
          className={`menu-item${i === open.index ? ' active' : ''}`}
          title={o.detail}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(o.name);
          }}
        >
          <span className="menu-label">{o.name}</span>
          <span className="var-suggest-detail menu-hint">{o.detail}</span>
        </li>
      ))}
    </ul>
  );
  return { update, keyDown, close, list };
}

export type VarInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange(value: string): void;
  variables?: readonly RestEnvVar[];
};

/** An input that suggests `{{name}}` after `{{`; without `variables` a plain input. */
export function VarInput({ value, onValueChange, variables, onKeyDown, onBlur, ...rest }: VarInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const s = useVarSuggest(variables, input, onValueChange);
  if (!variables) return <input value={value} onChange={(e) => onValueChange(e.target.value)} onKeyDown={onKeyDown} onBlur={onBlur} {...rest} />;
  return (
    <span className="var-suggest-wrap">
      <input
        ref={input}
        value={value}
        {...rest}
        onChange={(e) => {
          onValueChange(e.target.value);
          s.update(e.target);
        }}
        onKeyDown={(e) => {
          if (!s.keyDown(e)) onKeyDown?.(e);
        }}
        onSelect={(e) => s.update(e.currentTarget)}
        onBlur={(e) => {
          s.close();
          onBlur?.(e);
        }}
      />
      {s.list}
    </span>
  );
}
