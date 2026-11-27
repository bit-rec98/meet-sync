import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';

type ConfirmPanelProps = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The confirmed action is running. */
  pending?: boolean;
  /** A failure of the confirmed action, shown inside the panel. */
  children?: ReactNode;
};

/**
 * Asks before an action that is hard to undo. It appears in place (not as a pop-up), and focus
 * moves to its heading so keyboard and screen reader users arrive at the question.
 */
export function ConfirmPanel({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  pending = false,
  children,
}: ConfirmPanelProps) {
  const headingId = useId();
  const bodyId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      className="mt-4 rounded-xl border border-danger-edge bg-danger-bg p-4"
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-danger-ink">
        {title}
      </h2>
      <p id={bodyId} className="mt-1 text-sm text-danger-ink">
        {body}
      </p>
      {children}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={onConfirm} pending={pending}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
      </div>
    </section>
  );
}
