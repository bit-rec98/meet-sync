import type { ComponentProps } from 'react';

type TextFieldProps = Omit<ComponentProps<'input'>, 'id' | 'aria-invalid' | 'aria-describedby'> & {
  id: string;
  label: string;
  /** Problem with the current value. Shown below the field and linked to it for screen readers. */
  error?: string | undefined;
  /** Help shown below the field, also linked to it. */
  hint?: string | undefined;
};

export function TextField({ id, label, error, hint, className = '', ...input }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-field px-3 py-2 text-ink placeholder:text-ink-muted ${
          error ? 'border-danger-edge' : 'border-control-edge'
        } ${className}`}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
