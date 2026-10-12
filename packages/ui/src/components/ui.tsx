import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { errorMessage, type ApiError } from '../api';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { type IconName, PATHS } from '../icons';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted';

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-label={t('common.loading')} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Page header: one slim row, title left, the screen's actions right (they wrap below when they don't fit). */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="content-head">
      <h1>{title}</h1>
      <span className="spacer" />
      {children}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, compact }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`error-banner${compact ? ' compact' : ''}`} role="alert">
      <div className="error-main">
        <Icon name="alert" />
        <div className="error-text">
          <strong>{errorMessage(error)}</strong>
        </div>
        <div className="error-actions">
          {error.detail && (
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
              {open ? t('common.hideDetails') : t('common.details')}
            </button>
          )}
          {onRetry && (
            <button className="btn btn-sm" onClick={onRetry}>
              <Icon name="refresh" /> {t('common.retry')}
            </button>
          )}
        </div>
      </div>
      {open && <pre className="error-detail">{error.detail}</pre>}
    </div>
  );
}

export function CopyButton({ text, label = t('common.copy') }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1200);
        }
      }}
      title={label}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {label && <span>{done ? t('common.copied') : label}</span>}
    </button>
  );
}

// Open modals, newest last. The command palette registers too (`useModalOpen`).
const openModals: object[] = [];

/** A Modal or the command palette is open: global shortcuts should stay quiet. */
export function isModalOpen(): boolean {
  return openModals.length > 0;
}

/** Counts the component as an open modal while it is mounted; returns whether it is the topmost one. */
export function useModalOpen(): () => boolean {
  const token = useRef({});
  useLayoutEffect(() => {
    const me = token.current;
    openModals.push(me);
    return () => {
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, []);
  return useCallback(() => openModals[openModals.length - 1] === token.current, []);
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog; Escape or a click on the backdrop closes it. Focuses its first field (or an
 * `autoFocus` element), keeps Tab inside and gives the focus back on close.
 */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children?: ReactNode; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const isTop = useModalOpen();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previous = useRef(document.activeElement);

  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = ['.modal-body', '.modal-foot', '.modal-head']
        .map((part) => el.querySelector(part)?.querySelector<HTMLElement>(FOCUSABLE))
        .find(Boolean);
      (first ?? el).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTop()) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const prev = previous.current;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, [isTop]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !box.current) return;
    e.stopPropagation();
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first) e.preventDefault();
    else if (e.shiftKey && (active === first || active === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={trapTab}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  okLabel?: string;
  /** Red OK button; Cancel gets the focus. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  /** A message shown under the input; OK stays disabled while it returns one. */
  validate?(value: string): string | null;
}

export interface ChoiceOptions {
  title: string;
  body?: ReactNode;
  /** Buttons after Cancel, in order; the first one has the focus. */
  choices: Array<{ id: string; label: string; danger?: boolean }>;
  /** A checkbox under the body; `onChange` gets its state each time it is toggled. */
  checkbox?: { label: string; onChange: (checked: boolean) => void };
}

type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }
  | { id: number; kind: 'choice'; opts: ChoiceOptions; resolve: (id: string | null) => void };

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(false)}
      footer={
        <>
          <button className="btn" onClick={() => onDone(false)} autoFocus={opts.danger}>{t('dialog.cancel')}</button>
          <button className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onDone(true)} autoFocus={!opts.danger}>
            {opts.okLabel ?? t('dialog.ok')}
          </button>
        </>
      }
    >
      {typeof opts.body === 'string' ? <p>{opts.body}</p> : opts.body}
    </Modal>
  );
}

function ChoiceDialog({ opts, onDone }: { opts: ChoiceOptions; onDone: (id: string | null) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>{t('dialog.cancel')}</button>
          {opts.choices.map((c, i) => (
            <button key={c.id} className={`btn ${c.danger ? 'btn-danger' : i === 0 ? 'btn-primary' : ''}`} onClick={() => onDone(c.id)} autoFocus={i === 0}>
              {c.label}
            </button>
          ))}
        </>
      }
    >
      {typeof opts.body === 'string' ? <p>{opts.body}</p> : opts.body}
      {opts.checkbox && (
        <label className="row">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              opts.checkbox!.onChange(e.target.checked);
            }}
          />
          <span>{opts.checkbox.label}</span>
        </label>
      )}
    </Modal>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => input.current?.select(), []);
  const message = opts.validate?.(value) ?? null;
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>{t('dialog.cancel')}</button>
          <button type="submit" form={id} className="btn btn-primary" disabled={message !== null}>{t('dialog.ok')}</button>
        </>
      }
    >
      <form
        id={id}
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (message === null) onDone(value);
        }}
      >
        <label htmlFor={`${id}-input`}>{opts.label}</label>
        <input ref={input} id={`${id}-input`} value={value} autoFocus aria-invalid={message !== null} onChange={(e) => setValue(e.target.value)} />
        {message !== null && <span className="field-error">{message}</span>}
      </form>
    </Modal>
  );
}

let dialogIds = 0;

/**
 * Promise-based confirm, prompt and choice dialogs. Render `element` once in the component; all
 * resolve on OK, Cancel or Escape (confirm → false, prompt and choice → null), also when the
 * component unmounts.
 */
export function useDialogs(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  choose: (opts: ChoiceOptions) => Promise<string | null>;
  element: ReactNode;
} {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const pending = useRef<DialogRequest[]>([]);

  const push = useCallback((req: DialogRequest) => {
    pending.current.push(req);
    setQueue((q) => [...q, req]);
  }, []);
  const settle = (req: DialogRequest, value: boolean | string | null) => {
    pending.current = pending.current.filter((r) => r !== req);
    setQueue((q) => q.filter((r) => r !== req));
    if (req.kind === 'confirm') req.resolve(value === true);
    else req.resolve(typeof value === 'string' ? value : null);
  };

  useEffect(() => () => {
    for (const req of pending.current) {
      if (req.kind === 'confirm') req.resolve(false);
      else req.resolve(null);
    }
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => push({ id: ++dialogIds, kind: 'confirm', opts, resolve })), [push]);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => push({ id: ++dialogIds, kind: 'prompt', opts, resolve })), [push]);

  const choose = useCallback((opts: ChoiceOptions) => new Promise<string | null>((resolve) => push({ id: ++dialogIds, kind: 'choice', opts, resolve })), [push]);

  const req = queue[0];
  const element = !req ? null : req.kind === 'confirm'
    ? <ConfirmDialog key={req.id} opts={req.opts} onDone={(ok) => settle(req, ok)} />
    : req.kind === 'choice'
      ? <ChoiceDialog key={req.id} opts={req.opts} onDone={(id) => settle(req, id)} />
      : <PromptDialog key={req.id} opts={req.opts} onDone={(value) => settle(req, value)} />;
  return { confirm, prompt, choose, element };
}

export type { IconName } from '../icons';

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#9b8cff" />
      <rect x="4" y="4" width="16" height="16" rx="2.6" fill="#120d2b" />
      <rect x="5.4" y="5.4" width="5.6" height="2.4" rx="1" fill="#9b8cff" />
      <rect x="12" y="5.4" width="4.4" height="2.4" rx="1" fill="#9b8cff" opacity=".4" />
      <rect x="5.6" y="9.8" width="3.8" height="3.8" rx="1" fill="#9b8cff" />
      <rect x="10.1" y="9.8" width="3.8" height="3.8" rx="1" fill="#9b8cff" opacity=".7" />
      <rect x="14.6" y="9.8" width="3.8" height="3.8" rx="1" fill="#9b8cff" opacity=".4" />
      <rect x="5.6" y="14.4" width="3.8" height="3.8" rx="1" fill="#9b8cff" opacity=".7" />
      <rect x="10.1" y="14.4" width="3.8" height="3.8" rx="1" fill="#9b8cff" opacity=".4" />
      <rect x="14.85" y="14.65" width="3.3" height="3.3" rx=".9" fill="none" stroke="#9b8cff" strokeWidth=".7" strokeDasharray="1.2 .9" />
    </svg>
  );
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
