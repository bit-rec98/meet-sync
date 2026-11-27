import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, reply } from '../test/fakeApi';
import { inFuture, meeting } from '../test/meetingFixtures';
import { ANA, renderApp, signedInApi } from '../test/render';

const CREATE = 'POST /api/v1/meetings';
const callsTo = (api: { calls: { method: string; path: string }[] }, route: string): number =>
  api.calls.filter((call) => `${call.method} ${call.path}` === route).length;

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const setValue = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const describedBy = (element: HTMLElement): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

const DAY_MS = 24 * 3600_000;
const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A moment some days ahead at hh:mm in Buenos Aires (UTC-3, the zone tests run in): as the value of
 * a datetime-local input, and, worked out independently of the app, as the UTC instant it means.
 */
function momentAhead(
  daysAhead: number,
  hours: number,
  minutes = 0,
): { local: string; utc: string } {
  const base = new Date(Date.now() + daysAhead * DAY_MS);
  const [year, month, day] = [base.getFullYear(), base.getMonth(), base.getDate()];
  return {
    local: `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`,
    utc: new Date(Date.UTC(year, month, day, hours + 3, minutes)).toISOString(),
  };
}

describe('scheduling a meeting', () => {
  it('starts with sensible defaults: next whole hour, one hour, video call', async () => {
    renderApp({ api: signedInApi(), route: '/meetings/new' });
    expect(
      await screen.findByRole('heading', { name: 'Schedule a meeting', level: 1 }),
    ).toBeTruthy();
    expect(field('Title').value).toBe('');
    expect(field('Starts at').value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
    expect(field('Duration (minutes)').value).toBe('60');
    expect((screen.getByRole('radio', { name: /Video call/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: /Audio call/ }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(describedBy(field('Starts at'))).toMatch(/In your time zone \(.*Buenos_Aires\)/);
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/');
  });

  it('refuses an empty title before sending anything, and focuses it', async () => {
    const api = signedInApi();
    const { user } = renderApp({ api, route: '/meetings/new' });
    await screen.findByRole('heading', { name: 'Schedule a meeting' });
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    expect(field('Title').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(field('Title'))).toBe('Enter a title.');
    expect(document.activeElement).toBe(field('Title'));
    expect(callsTo(api, CREATE)).toBe(0);
  });

  it('sends the typed local time as UTC, with trimmed text and no description as null, then opens the meeting', async () => {
    const created = meeting({ id: 'm-new', title: 'Planning', role: 'host' });
    const api = signedInApi(ANA, {
      [CREATE]: () => reply(201, created),
      'GET /api/v1/meetings/m-new': () => reply(200, created),
    });
    const { user } = renderApp({ api, route: '/meetings/new' });
    await screen.findByRole('heading', { name: 'Schedule a meeting' });

    await user.type(field('Title'), '  Planning ');
    const when = momentAhead(10, 12);
    setValue('Starts at', when.local);
    await user.clear(field('Duration (minutes)'));
    await user.type(field('Duration (minutes)'), '45');
    await user.click(screen.getByRole('radio', { name: /Audio call/ }));
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Meeting scheduled.')).toBeTruthy();

    const body = api.calls.find(
      (call) => call.method === 'POST' && call.path === '/api/v1/meetings',
    )?.body;
    expect(body).toMatchObject({
      title: 'Planning',
      description: null,
      durationMinutes: 45,
      callType: 'audio',
    });
    // 12:00 in Buenos Aires (UTC-3) is 15:00 UTC.
    expect((body as { startsAt: string }).startsAt).toBe(when.utc);
    expect(when.utc).toMatch(/T15:00:00\.000Z$/);
  });

  it('checks the date, duration and description in the browser', async () => {
    const api = signedInApi();
    const { user } = renderApp({ api, route: '/meetings/new' });
    await screen.findByRole('heading', { name: 'Schedule a meeting' });

    await user.type(field('Title'), 'Planning');
    setValue('Starts at', '2020-01-01T10:00');
    await user.clear(field('Duration (minutes)'));
    await user.type(field('Duration (minutes)'), '4');
    fireEvent.change(field('Description (optional)'), { target: { value: 'x'.repeat(2001) } });
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    expect(describedBy(field('Starts at'))).toContain('Choose a time that is not in the past.');
    expect(describedBy(field('Duration (minutes)'))).toContain(
      'Enter a whole number of minutes between 5 and 480.',
    );
    expect(describedBy(field('Description (optional)'))).toContain('Use at most 2000 characters.');
    expect(document.activeElement).toBe(field('Description (optional)')); // first invalid, in form order
    expect(callsTo(api, CREATE)).toBe(0);

    setValue('Starts at', '2099-01-01T10:00');
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    expect(describedBy(field('Starts at'))).toContain('Choose a date within the next year.');
  });

  it('shows a rule the server enforces on the right field', async () => {
    const api = signedInApi(ANA, {
      [CREATE]: () =>
        apiError(400, 'validation_error', [{ path: 'startsAt', code: 'in_the_past' }]),
    });
    const { user } = renderApp({ api, route: '/meetings/new' });
    await user.type(await screen.findByLabelText('Title'), 'Planning');
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    await waitFor(() => expect(field('Starts at').getAttribute('aria-invalid')).toBe('true'));
    expect(describedBy(field('Starts at'))).toContain('Choose a time that is not in the past.');
    expect(document.activeElement).toBe(field('Starts at'));
  });

  it('keeps what was typed and explains a network failure, then allows trying again', async () => {
    const api = signedInApi(ANA, {
      [CREATE]: () => {
        throw new TypeError('offline');
      },
    });
    const { user } = renderApp({ api, route: '/meetings/new' });
    await user.type(await screen.findByLabelText('Title'), 'Planning');
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
    expect(field('Title').value).toBe('Planning');
    expect(
      (screen.getByRole('button', { name: 'Schedule meeting' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('sends the request once even if the button is pressed repeatedly', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const created = meeting({ id: 'm-new' });
    const api = signedInApi(ANA, {
      [CREATE]: async () => {
        await gate;
        return reply(201, created);
      },
      'GET /api/v1/meetings/m-new': () => reply(200, created),
    });
    const { user } = renderApp({ api, route: '/meetings/new' });
    await user.type(await screen.findByLabelText('Title'), 'Planning');
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    const busy = await screen.findByRole('button', { name: 'Scheduling…' });
    await user.click(busy);
    await user.click(busy);
    release();
    await screen.findByRole('heading', { name: created.title, level: 1 });
    expect(callsTo(api, CREATE)).toBe(1);
  });

  it('is available in Spanish', async () => {
    renderApp({ api: signedInApi(), route: '/meetings/new', language: 'es' });
    expect(
      await screen.findByRole('heading', { name: 'Programar una reunión', level: 1 }),
    ).toBeTruthy();
    expect(field('Título')).toBeTruthy();
    expect(field('Comienza')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Videollamada/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Programar reunión' })).toBeTruthy();
  });
});

describe('editing a meeting', () => {
  const when = momentAhead(30, 12); // 12:00 in Buenos Aires = 15:00 UTC, within the year the form allows
  const saved = meeting({
    id: 'm1',
    title: 'Planning',
    description: 'Agenda',
    startsAt: when.utc,
    durationMinutes: 90,
    callType: 'video',
    role: 'host',
  });
  const GET = 'GET /api/v1/meetings/m1';
  const PATCH = 'PATCH /api/v1/meetings/m1';

  it('fills the form from the meeting, showing the time in the user’s zone', async () => {
    renderApp({
      api: signedInApi(ANA, { [GET]: () => reply(200, saved) }),
      route: '/meetings/m1/edit',
    });
    expect(await screen.findByRole('heading', { name: 'Edit meeting', level: 1 })).toBeTruthy();
    expect(field('Title').value).toBe('Planning');
    expect(field('Description (optional)').value).toBe('Agenda');
    expect(field('Starts at').value).toBe(when.local);
    expect(field('Duration (minutes)').value).toBe('90');
    expect((screen.getByRole('radio', { name: /Video call/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/meetings/m1');
  });

  it('sends only what changed, then returns to the meeting with a notice', async () => {
    const api = signedInApi(ANA, {
      [GET]: () => reply(200, saved),
      [PATCH]: () => reply(200, { ...saved, title: 'Renamed' }),
    });
    const { user } = renderApp({ api, route: '/meetings/m1/edit' });
    await user.clear(await screen.findByLabelText('Title'));
    await user.type(field('Title'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Meeting updated.')).toBeTruthy();
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ title: 'Renamed' });
  });

  it('can clear the description and change the time, converting local time to UTC', async () => {
    const api = signedInApi(ANA, {
      [GET]: () => reply(200, saved),
      [PATCH]: () => reply(200, saved),
    });
    const { user } = renderApp({ api, route: '/meetings/m1/edit' });
    await screen.findByRole('heading', { name: 'Edit meeting' });
    await user.clear(field('Description (optional)'));
    const later = momentAhead(31, 9, 30);
    setValue('Starts at', later.local);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(callsTo(api, PATCH)).toBe(1));
    expect(api.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      description: null,
      startsAt: later.utc,
    });
  });

  it('does not call the API when nothing changed', async () => {
    const api = signedInApi(ANA, { [GET]: () => reply(200, saved) });
    const { user } = renderApp({ api, route: '/meetings/m1/edit' });
    await screen.findByRole('heading', { name: 'Edit meeting' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();
    expect(callsTo(api, PATCH)).toBe(0);
  });

  it('says the meeting can no longer be edited when it started, was cancelled, or is not the user’s', async () => {
    const cases = [
      meeting({ ...saved, startsAt: inFuture(-3600_000) }),
      meeting({ ...saved, status: 'cancelled' }),
      meeting({ ...saved, role: 'invitee' }),
    ];
    for (const unavailable of cases) {
      const view = renderApp({
        api: signedInApi(ANA, { [GET]: () => reply(200, unavailable) }),
        route: '/meetings/m1/edit',
      });
      expect(await screen.findByText('This meeting can no longer be edited.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Back to meetings' })).toBeTruthy();
      view.unmount();
    }
  });

  it('explains when the meeting changed in the meantime', async () => {
    const api = signedInApi(ANA, {
      [GET]: () => reply(200, saved),
      [PATCH]: () => apiError(409, 'invalid_state'),
    });
    const { user } = renderApp({ api, route: '/meetings/m1/edit' });
    await user.clear(await screen.findByLabelText('Title'));
    await user.type(field('Title'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The meeting changed');
    expect(field('Title').value).toBe('Renamed');
  });

  it('explains a meeting that does not exist or is not visible', async () => {
    renderApp({
      api: signedInApi(ANA, { [GET]: () => apiError(404, 'not_found') }),
      route: '/meetings/m1/edit',
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This meeting does not exist, or you do not have access to it.',
    );
  });
});
