import { useRef, useState } from 'react';
import type { FieldProblem, FormField } from '../forms/validation';
import { describeFailure, type ErrorTextKey } from './authErrors';

export type FieldProblems = Partial<Record<FormField, FieldProblem>>;

/**
 * State shared by the login and registration forms: field problems, a form-level error, and a
 * pending flag that prevents double submission. On problems, focus moves to the first invalid field.
 */
export function useAuthForm(fieldOrder: readonly FormField[]) {
  const [problems, setProblems] = useState<FieldProblems>({});
  const [formError, setFormError] = useState<ErrorTextKey | null>(null);
  const [pending, setPending] = useState(false);
  const inputs = useRef<Partial<Record<FormField, HTMLInputElement | null>>>({});

  /** A callback ref for the input of a field. */
  const inputRef = (field: FormField) => (element: HTMLInputElement | null) => {
    inputs.current[field] = element;
  };

  function show(found: FieldProblems, form?: ErrorTextKey): void {
    setProblems(found);
    setFormError(form ?? null);
    const firstInvalid = fieldOrder.find((field) => found[field]);
    if (firstInvalid) inputs.current[firstInvalid]?.focus();
  }

  function clearProblem(field: FormField): void {
    setProblems((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  }

  /**
   * Runs `action` unless the browser-side checks found problems or a request is already running.
   * A failed action is turned into field problems and/or a form-level message.
   */
  async function submit(clientProblems: FieldProblems, action: () => Promise<void>): Promise<void> {
    if (pending) return;
    if (Object.keys(clientProblems).length > 0) {
      show(clientProblems);
      return;
    }
    show({});
    setPending(true);
    try {
      await action();
    } catch (error) {
      const failure = describeFailure(error);
      show(failure.fields ?? {}, failure.form);
    } finally {
      setPending(false);
    }
  }

  return { problems, formError, pending, inputRef, clearProblem, submit };
}

/** Keeps only the fields that have a problem. */
export function collectProblems(
  checks: Partial<Record<FormField, FieldProblem | null>>,
): FieldProblems {
  const found: FieldProblems = {};
  for (const [field, problem] of Object.entries(checks)) {
    if (problem) found[field as FormField] = problem;
  }
  return found;
}
