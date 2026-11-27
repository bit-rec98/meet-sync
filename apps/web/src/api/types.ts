/** The user as returned by the API (never includes a password or hash). */
export type User = { id: string; email: string; displayName: string };

export type AuthResponse = { user: User; accessToken: string };

/** A field and the rule it broke, as reported by the API for invalid input. */
export type FieldIssue = { path: string; code: string };
