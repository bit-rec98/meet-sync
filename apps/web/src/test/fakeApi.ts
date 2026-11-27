/** A fake `fetch` for tests: routes are declared per "METHOD /path"; anything else fails loudly. */

export type FakeRequest = {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
};

export type FakeReply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Handler = (request: FakeRequest) => FakeReply | Promise<FakeReply>;

export type FakeApi = {
  fetch: typeof fetch;
  /** Every request received, in order. */
  calls: FakeRequest[];
  /** Requests to routes nobody declared. The client would report these as network errors. */
  unexpected: string[];
  /** Replaces or adds a route while a test runs. */
  on(route: string, handler: Handler): void;
};

export const reply = (
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): FakeReply => ({
  status,
  ...(body === undefined ? {} : { body }),
  ...(headers ? { headers } : {}),
});

/** An API error reply in the same shape the real API uses. */
export const apiError = (
  status: number,
  code: string,
  details?: { path: string; code: string }[],
  headers?: Record<string, string>,
): FakeReply =>
  reply(
    status,
    {
      error: {
        code,
        message: 'English message that the UI must not show.',
        ...(details ? { details } : {}),
      },
    },
    headers,
  );

/** Answers each call to the route with the next reply; once they run out, the last one repeats. */
export function sequence(...replies: FakeReply[]): Handler {
  let calls = 0;
  return () => {
    const next = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    if (!next) throw new Error('sequence() needs at least one reply');
    return next;
  };
}

export function createFakeApi(routes: Record<string, Handler> = {}): FakeApi {
  const handlers = new Map(Object.entries(routes));
  const calls: FakeRequest[] = [];
  const unexpected: string[] = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const request: FakeRequest = {
      method,
      path: url.pathname + url.search,
      headers: new Headers(init?.headers),
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
    };
    calls.push(request);

    const handler = handlers.get(`${method} ${request.path}`);
    if (!handler) {
      unexpected.push(`${method} ${request.path}`);
      throw new Error(`Unexpected request: ${method} ${request.path}`);
    }
    const result = await handler(request);
    const hasBody = result.status !== 204 && result.body !== undefined;
    return new Response(hasBody ? JSON.stringify(result.body) : null, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', ...result.headers },
    });
  };

  return {
    fetch: fakeFetch,
    calls,
    unexpected,
    on: (route, handler) => handlers.set(route, handler),
  };
}
