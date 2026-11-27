/** True when MySQL rejected a statement because a unique key already exists (e.g. a taken email). */
export function isDuplicateEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
  );
}
