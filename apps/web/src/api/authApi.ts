import type { ApiClient } from './client';
import { ApiError } from './errors';
import type { AuthResponse, User } from './types';

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & { displayName: string };

function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'email' in value &&
    typeof value.email === 'string' &&
    'displayName' in value &&
    typeof value.displayName === 'string'
  );
}

/** Refuses an answer that is not what the API documents, instead of crashing later in the UI. */
function parseAuthResponse(value: unknown): AuthResponse {
  if (
    typeof value === 'object' &&
    value !== null &&
    'user' in value &&
    isUser(value.user) &&
    'accessToken' in value &&
    typeof value.accessToken === 'string'
  ) {
    return { user: value.user, accessToken: value.accessToken };
  }
  throw new ApiError({ status: 200, code: 'unknown_error' });
}

export type AuthApi = ReturnType<typeof createAuthApi>;

export function createAuthApi(client: ApiClient) {
  async function startSession(path: string, body: LoginInput | RegisterInput): Promise<User> {
    const answer = await client.request<unknown>('POST', path, { body, authenticated: false });
    const { user, accessToken } = parseAuthResponse(answer);
    client.setAccessToken(accessToken);
    return user;
  }

  return {
    register: (input: RegisterInput): Promise<User> => startSession('/auth/register', input),

    login: (input: LoginInput): Promise<User> => startSession('/auth/login', input),

    async currentUser(): Promise<User> {
      const answer = await client.request<unknown>('GET', '/auth/me');
      if (
        typeof answer === 'object' &&
        answer !== null &&
        'user' in answer &&
        isUser(answer.user)
      ) {
        return answer.user;
      }
      throw new ApiError({ status: 200, code: 'unknown_error' });
    },

    /**
     * Ends the session on the server and always forgets the access token locally, even when the
     * server cannot be reached (in that case the refresh cookie stays valid until it expires).
     */
    async logout(): Promise<void> {
      try {
        await client.request('POST', '/auth/logout', { authenticated: false });
      } finally {
        client.setAccessToken(null);
      }
    },
  };
}
