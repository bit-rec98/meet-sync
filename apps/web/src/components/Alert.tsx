import type { ReactNode } from 'react';

type AlertProps = {
  /** `error` is announced immediately by screen readers; `info` politely. */
  variant: 'error' | 'info';
  children: ReactNode;
};

export function Alert({ variant, children }: AlertProps) {
  const style =
    variant === 'error'
      ? 'border-danger-edge bg-danger-bg text-danger-ink'
      : 'border-link/50 bg-field text-ink';
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`mt-4 rounded-lg border px-4 py-3 text-sm ${style}`}
    >
      {children}
    </div>
  );
}
