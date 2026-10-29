import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { IconName } from '../icons';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { Button, IconButton } from './Button';
import { Icon } from './ui';

export interface ToastOptions {
  message: string;
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
  /** Ms until it closes; default 4 s (the provider's `defaultTimeout`) for info, 10 s for errors; 0 keeps it until closed. */
  timeout?: number;
  /** A toast with the same key replaces the one on screen, in place; for progress that updates. */
  key?: string;
  /** Icon in front of the message; default `check` (`alert` for errors). */
  icon?: IconName;
}

interface Entry extends ToastOptions {
  id: number;
  /** The React key; a replacement keeps the replaced toast's, so it updates without a new entrance. */
  view: number;
}

/** Most toasts shown at once; a new one drops the oldest. */
const MAX_TOASTS = 3;

type Show = (opts: ToastOptions) => void;
const ToastContext = createContext<Show>(() => {});

let toastIds = 0;
/** The mounted provider's `show`, for code outside React (menu items, side-panel content). */
let showGlobal: Show = () => {};

/** Copies `text` and confirms with a toast ("Copied" by default), or an error toast when the clipboard refuses. */
export async function copyNotify(text: string, message: string = t('common.copied')): Promise<boolean> {
  const ok = await copyText(text);
  showGlobal(ok ? { message, timeout: 1500 } : { message: t('common.copyFailed'), kind: 'error' });
  return ok;
}

/** Holds the toast stack (bottom right) of everything below it; `useToast` reaches it. */
export function ToastProvider({ children, defaultTimeout = 4000 }: { children: ReactNode; defaultTimeout?: number }) {
  const [toasts, setToasts] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);

  const show = useCallback<Show>(
    (opts) =>
      setToasts((list) => {
        const id = ++toastIds;
        const at = opts.key === undefined ? -1 : list.findIndex((e) => e.key === opts.key);
        if (at >= 0) return list.map((e, i) => (i === at ? { ...opts, id, view: e.view } : e));
        return [...list, { ...opts, id, view: id }].slice(-MAX_TOASTS);
      }),
    [],
  );
  useEffect(() => {
    showGlobal = show;
    return () => { if (showGlobal === show) showGlobal = () => {}; };
  }, [show]);
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
        {toasts.map((entry) => <Toast key={entry.view} entry={entry} paused={paused} defaultTimeout={defaultTimeout} onClose={() => close(entry.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a short message: `toast({ message, kind, action, timeout })`. Needs a `ToastProvider` above. */
export function useToast(): Show {
  return useContext(ToastContext);
}

/** `useToast` for a view: toasts without their own `icon` get the view's. */
export function useViewToast(icon: IconName): Show {
  const show = useToast();
  return useCallback<Show>((opts) => show({ icon, ...opts }), [show, icon]);
}

function Toast({ entry, paused, defaultTimeout, onClose }: { entry: Entry; paused: boolean; defaultTimeout: number; onClose: () => void }) {
  const error = entry.kind === 'error';
  const timeout = entry.timeout ?? (error ? 10_000 : defaultTimeout);
  const left = useRef(timeout);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    left.current = timeout;
  }, [entry.id, timeout]);

  useEffect(() => {
    if (paused || timeout <= 0) return;
    const start = Date.now();
    const timer = window.setTimeout(() => closeRef.current(), left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [paused, timeout, entry.id]);

  return (
    <div className={`toast${error ? ' toast-error' : ''}`} role={error ? 'alert' : 'status'}>
      <Icon name={entry.icon ?? (error ? 'alert' : 'check')} size={14} />
      <span className="toast-text">{entry.message}</span>
      {entry.action && (
        <Button variant="ghost" size="sm" title={entry.action.label} onClick={() => { entry.action!.run(); onClose(); }}>{entry.action.label}</Button>
      )}
      <IconButton icon="close" label={t('common.close')} onClick={onClose} />
    </div>
  );
}
