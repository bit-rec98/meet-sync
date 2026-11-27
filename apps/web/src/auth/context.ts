import { createContext } from 'react';
import type { LoginInput, RegisterInput } from '../api/authApi';
import type { ApiClient } from '../api/client';
import type { User } from '../api/types';

/** `loading` lasts only while the app checks whether the browser still has a valid session. */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  /** True when the server ended the session (not when the user logged out). Cleared by logging in. */
  sessionExpired: boolean;
  /** Reject with an ApiError when the server refuses (wrong password, email taken...). */
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
export const ApiClientContext = createContext<ApiClient | null>(null);
