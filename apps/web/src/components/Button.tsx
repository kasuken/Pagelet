import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

function classes(variant: ButtonVariant, extra?: string): string {
  return ['button', `button--${variant}`, extra].filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows the busy label and blocks repeat presses while an action is in flight. */
  busy?: boolean;
  busyLabel?: ReactNode;
}

export function Button({
  variant = 'primary',
  busy = false,
  busyLabel,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
}

export function LinkButton({ variant = 'primary', className, ...rest }: LinkButtonProps) {
  return <Link {...rest} className={classes(variant, className)} />;
}
