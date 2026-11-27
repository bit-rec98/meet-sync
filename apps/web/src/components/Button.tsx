import type { ComponentProps } from 'react';
import { buttonClassName, type ButtonVariant } from './buttonStyles';

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  /** A request is running: the button is disabled and announced as busy. */
  pending?: boolean;
};

export function Button({
  variant = 'primary',
  pending = false,
  type = 'button',
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClassName(variant, className)}
      {...props}
    />
  );
}
