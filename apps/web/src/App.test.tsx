import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useApiClient } from './auth/useAuth';
import { apiError, reply, sequence } from './test/fakeApi';
import {
  ANA,
  LOGIN,
  LOGOUT,
  REFRESH,
  REGISTER,
  anonymousApi,
  renderApp,
  signedInApi,
} from './test/render';

const callsTo = (api: { calls: { method: string; path: string }[] }, route: string): number =>
  api.calls.filter((call) => `${call.method} ${call.path}` === route).length;

/** The text of the elements an input points to with aria-describedby. */
function descriptionOf(input: HTMLElement): string {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

describe('session restore', () => {
  it('sends a visitor without a session to the login page', async () => {
    const { api } = renderApp({ api: anonymousApi() });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(callsTo(api, REFRESH)).toBe(1);
    expect(api.unexpected).toEqual([]);
  });

  it('shows the start page, with the user’s name and a logout button, when the session is valid', async () => {
    const { api } = renderApp({ api: signedInApi() });
    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
    expect(screen.getByText('Signed in as Ana García')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(api.calls[1]?.headers.get('Authorization')).toBe('Bearer access-token-1');
  });

  it('shows a loading state while the session is being checked', async () => {
    const { findByRole } = renderApp({
      api: signedInApi(ANA, {
        [REFRESH]: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return reply(200, { accessToken: 'token' });
        },
      }),
    });
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(await findByRole('heading', { name: 'Meetings' })).toBeTruthy();
  });

  it('refreshes only once under React StrictMode, which runs effects twice', async () => {
    const { api } = renderApp({ api: signedInApi(), strict: true });
    await screen.findByRole('heading', { name: 'Meetings' });
    expect(callsTo(api, REFRESH)).toBe(1); // a second use of the cookie would end the session
  });

  it('treats a server error or being offline during restore as "not signed in"', async () => {
    renderApp({ api: anonymousApi({ [REFRESH]: () => apiError(503, 'internal_error') }) });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('sends a signed-in user away from the login and register pages', async () => {
    renderApp({ api: signedInApi(), route: '/login' });
    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
  });

  it('shows a not-found page with a way back', async () => {
    renderApp({ api: signedInApi(), route: '/does-not-exist' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the start page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});

describe('login', () => {
  it('logs in with the trimmed email and goes to the start page', async () => {
    const api = anonymousApi({
      [LOGIN]: () => reply(200, { user: ANA, accessToken: 'access-token-2' }),
    });
    const { user } = renderApp({ api, route: '/login' });

    await user.type(await screen.findByLabelText('Email'), '  ana@example.test ');
    await user.type(screen.getByLabelText('Password'), 'a password with spaces ');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
    const loginCall = api.calls.find((call) => call.path === '/api/v1/auth/login');
    expect(loginCall?.body).toEqual({
      email: 'ana@example.test',
      password: 'a password with spaces ',
    });
  });

  it('returns to the page the visitor wanted after logging in', async () => {
    const api = anonymousApi({ [LOGIN]: () => reply(200, { user: ANA, accessToken: 't' }) });
    const { user } = renderApp({ api, route: '/' });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
  });

  it('explains wrong credentials in the user’s language, never with the server’s English text', async () => {
    const api = anonymousApi({ [LOGIN]: () => apiError(401, 'invalid_credentials') });
    const { user } = renderApp({ api, route: '/login' });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The email or password is not correct.');
    expect(document.body.textContent).not.toContain('English message');
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('checks the form before sending anything, and focuses the first problem', async () => {
    const { api, user } = renderApp({ api: anonymousApi(), route: '/login' });
    await screen.findByRole('heading', { name: 'Log in' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(email)).toBe('Enter your email address.');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(password)).toBe('Enter your password.');
    expect(document.activeElement).toBe(email);
    expect(callsTo(api, LOGIN)).toBe(0);
  });

  it('clears a field’s error as soon as the user edits that field', async () => {
    const { user } = renderApp({ api: anonymousApi(), route: '/login' });
    await screen.findByRole('heading', { name: 'Log in' });
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    await user.type(email, 'a');
    expect(email.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
  });

  it('tells the user when there were too many attempts, or the network is down, or something else failed', async () => {
    const cases: [ReturnType<typeof apiError> | 'offline', string][] = [
      [
        apiError(429, 'rate_limited', undefined, { 'Retry-After': '300' }),
        'Too many attempts. Wait a few minutes and try again.',
      ],
      ['offline', 'Could not reach the server. Check your connection and try again.'],
      [apiError(500, 'internal_error'), 'Something went wrong. Try again.'],
    ];
    for (const [failure, expected] of cases) {
      const api = anonymousApi({
        [LOGIN]: () => {
          if (failure === 'offline') throw new TypeError('offline');
          return failure;
        },
      });
      const { user, unmount } = renderApp({ api, route: '/login' });
      await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
      await user.type(screen.getByLabelText('Password'), 'x');
      await user.click(screen.getByRole('button', { name: 'Log in' }));
      expect((await screen.findByRole('alert')).textContent).toBe(expected);
      unmount();
    }
  });

  it('disables the button while the request runs, and sends it only once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = anonymousApi({
      [LOGIN]: async () => {
        await gate;
        return reply(200, { user: ANA, accessToken: 't' });
      },
    });
    const { user } = renderApp({ api, route: '/login' });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const busy = await screen.findByRole('button', { name: 'Logging in…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await user.click(busy);
    expect(callsTo(api, LOGIN)).toBe(1);

    release();
    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
  });

  it('uses the right autocomplete hints so password managers work', async () => {
    renderApp({ api: anonymousApi(), route: '/login' });
    expect((await screen.findByLabelText('Email')).getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('never leaves the password or tokens in the page or in browser storage', async () => {
    const api = anonymousApi({
      [LOGIN]: () => reply(200, { user: ANA, accessToken: 'secret-access-token' }),
    });
    const { user } = renderApp({ api, route: '/login' });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'my-very-secret-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('heading', { name: 'Meetings' });

    expect(document.body.innerHTML).not.toContain('my-very-secret-password');
    expect(document.body.innerHTML).not.toContain('secret-access-token');
    const stored = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(stored).not.toContain('secret-access-token');
    expect(stored).not.toContain('my-very-secret-password');
  });
});

describe('registration', () => {
  it('creates the account with trimmed name and email and goes to the start page', async () => {
    const api = anonymousApi({
      [REGISTER]: () => reply(201, { user: ANA, accessToken: 'access-token-3' }),
    });
    const { user } = renderApp({ api, route: '/register' });
    await user.type(await screen.findByLabelText('Display name'), '  Ana García ');
    await user.type(screen.getByLabelText('Email'), ' ana@example.test ');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeTruthy();
    const call = api.calls.find((entry) => entry.path === '/api/v1/auth/register');
    expect(call?.body).toEqual({
      displayName: 'Ana García',
      email: 'ana@example.test',
      password: 'correct horse battery',
    });
  });

  it('explains the password rule up front and enforces it before sending', async () => {
    const { api, user } = renderApp({ api: anonymousApi(), route: '/register' });
    const password = await screen.findByLabelText('Password');
    expect(descriptionOf(password)).toBe('At least 12 characters.');
    expect(password.getAttribute('autocomplete')).toBe('new-password');

    await user.type(screen.getByLabelText('Display name'), 'Ana');
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(password, 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(descriptionOf(password)).toBe('At least 12 characters. Use at least 12 characters.');
    expect(document.activeElement).toBe(password);
    expect(callsTo(api, REGISTER)).toBe(0);
  });

  it('flags every invalid field at once, focusing the first in form order', async () => {
    const { user } = renderApp({ api: anonymousApi(), route: '/register' });
    await screen.findByRole('heading', { name: 'Create your account' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Display name'));
    for (const label of ['Display name', 'Email', 'Password']) {
      expect(screen.getByLabelText(label).getAttribute('aria-invalid'), label).toBe('true');
    }
  });

  it('attaches “email already registered” to the email field and focuses it', async () => {
    const api = anonymousApi({ [REGISTER]: () => apiError(409, 'email_taken') });
    const { user } = renderApp({ api, route: '/register' });
    await user.type(await screen.findByLabelText('Display name'), 'Ana');
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(descriptionOf(email)).toBe('An account with this email already exists.');
    expect(document.activeElement).toBe(email);
  });

  it('maps the server’s field issues to messages on those fields', async () => {
    const api = anonymousApi({
      [REGISTER]: () =>
        apiError(400, 'validation_error', [{ path: 'displayName', code: 'invalid_format' }]),
    });
    const { user } = renderApp({ api, route: '/register' });
    await user.type(await screen.findByLabelText('Display name'), 'Ana');
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const name = screen.getByLabelText('Display name');
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(descriptionOf(name)).toBe('The name contains characters that are not allowed.');
  });

  it('falls back to a general message when the server reports issues the form cannot place', async () => {
    const api = anonymousApi({
      [REGISTER]: () =>
        apiError(400, 'validation_error', [{ path: 'role', code: 'unrecognized_key' }]),
    });
    const { user } = renderApp({ api, route: '/register' });
    await user.type(await screen.findByLabelText('Display name'), 'Ana');
    await user.type(screen.getByLabelText('Email'), 'ana@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Some of the information is not valid',
    );
  });

  it('links between login and registration', async () => {
    const { user } = renderApp({ api: anonymousApi(), route: '/login' });
    await user.click(await screen.findByRole('link', { name: 'Create an account' }));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });
});

describe('logout and expired sessions', () => {
  it('logs out: calls the API, returns to the login page, and stops authenticating requests', async () => {
    const api = signedInApi(ANA, { [LOGOUT]: () => reply(204) });
    const { user } = renderApp({ api });
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(callsTo(api, LOGOUT)).toBe(1);
    expect(
      api.calls.find((call) => call.path === '/api/v1/auth/logout')?.headers.has('Authorization'),
    ).toBe(false);
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it('logs out locally even when the server cannot be reached', async () => {
    const api = signedInApi(ANA, {
      [LOGOUT]: () => {
        throw new TypeError('offline');
      },
    });
    const { user } = renderApp({ api });
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
  });

  it('shows the login page with a notice when the server ends the session', async () => {
    const api = signedInApi(ANA, {
      'GET /api/v1/meetings': () => apiError(401, 'unauthorized'),
    });
    // After the first (successful) refresh, the server starts refusing to refresh.
    api.on(REFRESH, sequence(reply(200, { accessToken: 'first' }), apiError(401, 'unauthorized')));

    function ExpireButton() {
      const client = useApiClient();
      return (
        <button
          type="button"
          onClick={() => void client.request('GET', '/meetings').catch(() => {})}
        >
          call the API
        </button>
      );
    }
    const { user } = renderApp({ api, extra: <ExpireButton /> });
    await screen.findByRole('heading', { name: 'Meetings' });
    await user.click(screen.getByRole('button', { name: 'call the API' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Your session expired. Log in again.');
  });
});

describe('language', () => {
  it('shows the Spanish interface, with the page language set accordingly', async () => {
    renderApp({ api: anonymousApi(), route: '/login', language: 'es' });
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
    expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
    expect(screen.getByLabelText('Contraseña')).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
  });

  it('shows validation and server errors in Spanish', async () => {
    const api = anonymousApi({ [LOGIN]: () => apiError(401, 'invalid_credentials') });
    const { user } = renderApp({ api, route: '/login', language: 'es' });
    await screen.findByRole('heading', { name: 'Iniciar sesión' });
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(descriptionOf(screen.getByLabelText('Correo electrónico'))).toBe(
      'Ingresa tu correo electrónico.',
    );

    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.test');
    await user.type(screen.getByLabelText('Contraseña'), 'x');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'El correo o la contraseña no son correctos.',
    );
  });

  it('switches language on request, updates the page language, and remembers the choice', async () => {
    window.localStorage.clear();
    const { user } = renderApp({ api: anonymousApi(), route: '/login' });
    await screen.findByRole('heading', { name: 'Log in' });

    await user.selectOptions(screen.getByLabelText('Language'), 'es');
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('meetsync.language')).toBe('es');
    expect(screen.getByLabelText('Idioma')).toBeTruthy();
    window.localStorage.clear();
  });

  it('keeps the user’s name intact in the page header, rendered as text', async () => {
    renderApp({ api: signedInApi({ ...ANA, displayName: 'A & B <i>' }), language: 'es' });
    expect(await screen.findByText('Sesión iniciada como A & B <i>')).toBeTruthy();
    expect(document.querySelector('header i')).toBeNull(); // not interpreted as markup
  });
});

describe('accessibility basics', () => {
  it('has landmarks, a skip link as the first stop, and one main heading per page', async () => {
    const { user } = renderApp({ api: anonymousApi(), route: '/login' });
    await screen.findByRole('heading', { name: 'Log in' });

    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    await user.tab();
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skipLink);
    expect(skipLink.getAttribute('href')).toBe('#main');
  });

  it('labels every field of every form', async () => {
    for (const route of ['/login', '/register']) {
      const { container, unmount } = renderApp({ api: anonymousApi(), route });
      await screen.findByRole('heading', { level: 1 });
      for (const input of container.querySelectorAll('input')) {
        expect(input.labels?.length, `${route} #${input.id}`).toBeGreaterThan(0);
      }
      unmount();
    }
  });

  it('sets a page title for each page', async () => {
    renderApp({ api: anonymousApi(), route: '/register' });
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(document.title).toBe('Create your account · MeetSync');
  });
});
