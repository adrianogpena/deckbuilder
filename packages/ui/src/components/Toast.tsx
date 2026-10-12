import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Icon } from './ui';

export interface ToastOptions {
  message: string;
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
  /** Ms until it closes; default 4 s for info, 10 s for errors; 0 keeps it until closed. */
  timeout?: number;
}

interface Entry extends ToastOptions {
  id: number;
}

/** Most toasts shown at once; a new one drops the oldest. */
const MAX_TOASTS = 3;

type Show = (opts: ToastOptions) => void;
const ToastContext = createContext<Show>(() => {});

let toastIds = 0;

/** Holds the toast stack (bottom right) of everything below it; `useToast` reaches it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);

  const show = useCallback<Show>((opts) => setToasts((list) => [...list, { ...opts, id: ++toastIds }].slice(-MAX_TOASTS)), []);
  const close = useCallback((id: number) => setToasts((list) => list.filter((e) => e.id !== id)), []);

  // Escape closes the newest toast, unless something else (a dialog, the editor) used the key.
  const newest = toasts.at(-1)?.id;
  useEffect(() => {
    if (newest === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
      close(newest);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newest, close]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {toasts.map((entry) => <Toast key={entry.id} entry={entry} paused={paused} onClose={() => close(entry.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a short message: `toast({ message, kind, action, timeout })`. Needs a `ToastProvider` above. */
export function useToast(): Show {
  return useContext(ToastContext);
}

function Toast({ entry, paused, onClose }: { entry: Entry; paused: boolean; onClose: () => void }) {
  const error = entry.kind === 'error';
  const timeout = entry.timeout ?? (error ? 10_000 : 4000);
  const left = useRef(timeout);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (paused || timeout <= 0) return;
    const start = Date.now();
    const timer = window.setTimeout(() => closeRef.current(), left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [paused, timeout]);

  return (
    <div className={`toast${error ? ' toast-error' : ''}`} role={error ? 'alert' : 'status'}>
      <Icon name={error ? 'alert' : 'check'} size={14} />
      <span className="toast-text">{entry.message}</span>
      {entry.action && (
        <button className="btn btn-ghost btn-sm" onClick={() => { entry.action!.run(); onClose(); }}>{entry.action.label}</button>
      )}
      <button className="btn btn-ghost btn-sm toast-close" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
