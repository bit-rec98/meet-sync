import { ApiError } from './errors';

const API_BASE = '/api/v1';
const REFRESH_LOCK_NAME = 'meetsync-session-refresh';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  body?: unknown;
  /** Send the access token and, on a 401, refresh the session and retry. Default: true. */
  authenticated?: boolean;
};

/** Runs `work` while no other refresh is running, in this tab or (when supported) in any tab. */
export type RefreshLock = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * The server rotates the refresh cookie on every use and treats a second use of an old one as
 * theft, ending the session. Two refreshes racing (two tabs, or React StrictMode in development)
 * would trigger that, so refreshes are serialized across tabs with the Web Locks API when available.
 */
const webLocksRefreshLock: RefreshLock = (work) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(REFRESH_LOCK_NAME, work) : work();
};

export type ApiClientOptions = {
  fetch?: typeof fetch;
  refreshLock?: RefreshLock;
  /** Called when the server refuses to renew the session, so the app can show the login screen. */
  onSessionExpired?: () => void;
};

export type ApiClient = {
  /** Resolves with the parsed JSON body, or undefined for an empty (204) response. */
  request<T = undefined>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  /** The access token is kept in memory only: never in localStorage or sessionStorage. */
  setAccessToken(token: string | null): void;
  /** Gets a new access token from the refresh cookie. Concurrent calls share one request. */
  refreshSession(): Promise<void>;
};

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const lock = options.refreshLock ?? webLocksRefreshLock;

  let accessToken: string | null = null;
  let refreshing: Promise<void> | null = null;

  async function send(
    method: HttpMethod,
    path: string,
    { body, authenticated = true }: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
    try {
      return await doFetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError({ status: 0, code: 'network_error' });
    }
  }

  async function readResult<T>(response: Response): Promise<T> {
    if (!response.ok) throw await ApiError.fromResponse(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError({ status: response.status, code: 'unknown_error' });
    }
  }

  function refreshSession(): Promise<void> {
    refreshing ??= lock(async () => {
      const response = await send('POST', '/auth/refresh', { authenticated: false });
      const result = await readResult<unknown>(response);
      const token =
        typeof result === 'object' && result !== null && 'accessToken' in result
          ? result.accessToken
          : undefined;
      if (typeof token !== 'string') throw new ApiError({ status: 200, code: 'unknown_error' });
      accessToken = token;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    setAccessToken(token) {
      accessToken = token;
    },

    refreshSession,

    async request<T = undefined>(
      method: HttpMethod,
      path: string,
      requestOptions: RequestOptions = {},
    ): Promise<T> {
      let response = await send(method, path, requestOptions);

      if (response.status === 401 && (requestOptions.authenticated ?? true)) {
        try {
          await refreshSession();
        } catch (error) {
          // Only a refusal ends the session. A network failure says nothing about the session.
          if (error instanceof ApiError && error.status === 401) {
            accessToken = null;
            options.onSessionExpired?.();
            throw await ApiError.fromResponse(response);
          }
          throw error;
        }
        response = await send(method, path, requestOptions); // retried once, with the new token
      }

      return readResult<T>(response);
    },
  };
}
