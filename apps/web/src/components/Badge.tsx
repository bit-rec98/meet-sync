import type { ReactNode } from 'react';

type BadgeProps = {
  tone?: 'neutral' | 'accent' | 'danger';
  children: ReactNode;
};

// The meaning is always in the text; the color only reinforces it.
const TONES = {
  neutral: 'border-control-edge bg-field text-ink-muted',
  accent: 'border-link/50 bg-field text-link',
  danger: 'border-danger-edge bg-danger-bg text-danger-ink',
} as const;

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
