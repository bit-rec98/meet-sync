import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import type { User } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { createI18n } from '../i18n';
import type { Language } from '../i18n/language';
import { apiError, createFakeApi, reply, type FakeApi, type Handler } from './fakeApi';
import { list } from './meetingFixtures';

export const ANA: User = { id: 'user-1', email: 'ana@example.test', displayName: 'Ana García' };

export const REFRESH = 'POST /api/v1/auth/refresh';
export const ME = 'GET /api/v1/auth/me';
export const LOGIN = 'POST /api/v1/auth/login';
export const REGISTER = 'POST /api/v1/auth/register';
export const LOGOUT = 'POST /api/v1/auth/logout';
/** The first page of upcoming meetings, which the start page loads. */
export const UPCOMING = 'GET /api/v1/meetings?when=upcoming&limit=20&offset=0';

/** A browser that has no valid session: the refresh cookie is missing or rejected. */
export function anonymousApi(routes: Record<string, Handler> = {}): FakeApi {
  return createFakeApi({ [REFRESH]: () => apiError(401, 'unauthorized'), ...routes });
}

/** A browser whose refresh cookie is still valid. */
export function signedInApi(user: User = ANA, routes: Record<string, Handler> = {}): FakeApi {
  return createFakeApi({
    [REFRESH]: () => reply(200, { accessToken: 'access-token-1' }),
    [ME]: () => reply(200, { user }),
    // The start page lists meetings; by default the user has none.
    [UPCOMING]: () => reply(200, list([])),
    ...routes,
  });
}

type RenderOptions = {
  api: FakeApi;
  route?: string;
  language?: Language;
  /** Wrap in React StrictMode, which runs effects twice in development. */
  strict?: boolean;
  /** Extra content rendered next to the routes, inside the providers. */
  extra?: ReactNode;
  /** Router state the first page is opened with, as when another page navigates here. */
  state?: unknown;
};

/** "/path?query" as the router's separate pathname and search. */
function splitRoute(route: string): { pathname: string; search: string } {
  const url = new URL(route, 'http://localhost');
  return { pathname: url.pathname, search: url.search };
}

/** Renders the whole app with real providers against a fake API. */
export function renderApp({
  api,
  route = '/',
  language = 'en',
  strict = false,
  extra,
  state,
}: RenderOptions) {
  const i18n = createI18n(language);
  const user = userEvent.setup();
  const tree = (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[{ ...splitRoute(route), state }]}>
        <AuthProvider fetch={api.fetch}>
          <App />
          {extra}
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { api, i18n, user, ...view };
}
