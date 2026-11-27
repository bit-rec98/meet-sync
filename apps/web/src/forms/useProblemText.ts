import { useTranslation } from 'react-i18next';
import type { FieldProblem } from './validation';

/** Returns a function that turns a field problem into text in the current language. */
export function useProblemText(): (problem: FieldProblem | undefined) => string | undefined {
  const { t } = useTranslation();
  return (problem) => (problem ? t(`validation.${problem.key}`, { ...problem.values }) : undefined);
}
