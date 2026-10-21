import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { type IconName } from '../icons';
import { Icon } from './ui';

/** Button roles from docs/DESIGN.md: default (secondary), primary, ghost, danger. */
export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
/** md 30px (dialogs, forms), sm 28px (toolbars, pane heads), xs 22px (actions inside rows and section heads). */
export type ButtonSize = 'md' | 'sm' | 'xs';

const ICON_SIZE: Record<ButtonSize, number> = { md: 14, sm: 14, xs: 12 };

export function buttonClass(variant: ButtonVariant = 'default', size: ButtonSize = 'md', iconOnly = false, extra?: string): string {
  return ['btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, iconOnly && 'btn-icon', extra].filter(Boolean).join(' ');
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Toggle state: drawn as "on" (accent) when true. */
  pressed?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, pressed, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, false, className)} aria-pressed={pressed} {...rest}>
      {icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> {
  icon: IconName;
  /** Tooltip and accessible name; required since the button has no text. */
  label: string;
}

/** Square icon-only button; ghost by default. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'sm', icon, label, pressed, className, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, true, className)} aria-pressed={pressed} aria-label={label} title={title ?? label} {...rest}>
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  );
});

/** Thin divider between groups of toolbar buttons. */
export function ToolbarSep() {
  return <span className="toolbar-sep" aria-hidden="true" />;
}
