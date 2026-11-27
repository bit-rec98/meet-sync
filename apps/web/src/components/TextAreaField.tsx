import type { ComponentProps } from 'react';

type TextAreaFieldProps = Omit<
  ComponentProps<'textarea'>,
  'id' | 'aria-invalid' | 'aria-describedby'
> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
};

/** A multi-line field with the same label, hint and error wiring as {@link TextField}. */
export function TextAreaField({
  id,
  label,
  error,
  hint,
  className = '',
  ...textarea
}: TextAreaFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-field px-3 py-2 text-ink placeholder:text-ink-muted ${
          error ? 'border-danger-edge' : 'border-control-edge'
        } ${className}`}
        {...textarea}
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
