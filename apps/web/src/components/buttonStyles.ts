export type ButtonVariant = 'primary' | 'secondary';

const BASE =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'border border-control-edge bg-transparent text-ink hover:bg-surface',
};

/** The look shared by buttons and links that act like buttons. */
export function buttonClassName(variant: ButtonVariant, extra = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}
