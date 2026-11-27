import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, reply, sequence } from '../test/fakeApi';
import { GUEST, HOST, days, hours, inFuture, list, summary } from '../test/meetingFixtures';
import { ANA, UPCOMING, renderApp, signedInApi } from '../test/render';

const PAST = 'GET /api/v1/meetings?when=past&limit=20&offset=0';

function manyMeetings(count: number) {
  return Array.from({ length: count }, (_, index) =>
    summary({ id: `m${index}`, title: `Meeting ${index + 1}` }),
  );
}

describe('meetings list', () => {
  it('shows an empty state with a way to schedule the first meeting', async () => {
    renderApp({ api: signedInApi() });
    expect(await screen.findByRole('heading', { name: 'Meetings', level: 1 })).toBeTruthy();
    expect(await screen.findByText('You have no upcoming meetings.')).toBeTruthy();
    const schedule = screen.getByRole('link', { name: 'Schedule a meeting' });
    expect(schedule.getAttribute('href')).toBe('/meetings/new');
  });

  it('shows a different empty state, without a call to action, for past meetings', async () => {
    renderApp({
      api: signedInApi(ANA, { [PAST]: () => reply(200, list([])) }),
      route: '/?view=past',
    });
    expect(await screen.findByText('You have no past meetings.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Schedule a meeting' })).toBeNull();
  });

  it('lists meetings with their time in the user’s time zone, duration, role, call type and invitees', async () => {
    const api = signedInApi(ANA, {
      [UPCOMING]: () =>
        reply(
          200,
          list([
            summary({
              id: 'm1',
              title: 'Planning',
              startsAt: '2030-03-01T15:00:00.000Z', // 12:00 in Buenos Aires
              durationMinutes: 90,
              inviteeCount: 2,
            }),
            summary({
              id: 'm2',
              title: 'Daily',
              durationMinutes: 45,
              callType: 'audio',
              inviteeCount: 1,
            }),
            summary({
              id: 'm3',
              title: 'Offsite',
              role: 'invitee',
              host: HOST,
              durationMinutes: 60,
            }),
          ]),
        ),
    });
    renderApp({ api });

    const planning = (await screen.findByRole('link', { name: 'Planning' })).closest(
      'li',
    ) as HTMLElement;
    expect(planning.textContent).toContain('Mar 1, 2030');
    expect(planning.textContent).toContain('12:00');
    expect(planning.textContent).toContain('1 h 30 min');
    expect(planning.textContent).toContain('Host');
    expect(planning.textContent).toContain('Video');
    expect(planning.textContent).toContain('2 invitees');
    expect(screen.getByRole('link', { name: 'Planning' }).getAttribute('href')).toBe(
      '/meetings/m1',
    );

    const daily = screen.getByRole('link', { name: 'Daily' }).closest('li') as HTMLElement;
    expect(daily.textContent).toContain('45 min');
    expect(daily.textContent).toContain('Audio');
    expect(daily.textContent).toContain('1 invitee');
    expect(daily.textContent).not.toContain('1 invitees');

    const offsite = screen.getByRole('link', { name: 'Offsite' }).closest('li') as HTMLElement;
    expect(offsite.textContent).toContain('Invitee');
    expect(offsite.textContent).toContain('Hosted by Hana Host');
    expect(within(offsite).queryByText(/invitees?$/)).toBeNull();
  });

  it('marks meetings that are in progress, finished, or cancelled', async () => {
    const api = signedInApi(ANA, {
      [UPCOMING]: () =>
        reply(
          200,
          list([
            summary({
              id: 'a',
              title: 'Running',
              startsAt: inFuture(-hours(0.5)),
              durationMinutes: 60,
            }),
            summary({ id: 'b', title: 'Called off', status: 'cancelled' }),
            summary({ id: 'c', title: 'Done', startsAt: inFuture(-hours(3)), durationMinutes: 60 }),
          ]),
        ),
    });
    renderApp({ api });
    const card = async (title: string) =>
      (await screen.findByRole('link', { name: title })).closest('li') as HTMLElement;
    expect((await card('Running')).textContent).toContain('In progress');
    expect((await card('Called off')).textContent).toContain('Cancelled');
    expect((await card('Done')).textContent).toContain('Finished');
  });

  it('switches between upcoming and past through links, keeping the choice in the address', async () => {
    const api = signedInApi(ANA, {
      [PAST]: () =>
        reply(200, list([summary({ id: 'old', title: 'Old news', startsAt: inFuture(-days(2)) })])),
    });
    const { user } = renderApp({ api });
    const nav = await screen.findByRole('navigation', { name: 'Show' });
    expect(within(nav).getByRole('link', { name: 'Upcoming' }).getAttribute('aria-current')).toBe(
      'page',
    );

    await user.click(within(nav).getByRole('link', { name: 'Past' }));
    expect(await screen.findByRole('link', { name: 'Old news' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Past' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Upcoming' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Upcoming' }).getAttribute('href')).toBe('/');
    expect(within(nav).getByRole('link', { name: 'Past' }).getAttribute('href')).toBe(
      '/?view=past',
    );
  });

  it('ignores a slow answer for a view the user has already left', async () => {
    let releaseUpcoming: () => void = () => {};
    const slow = new Promise<void>((resolve) => (releaseUpcoming = resolve));
    const api = signedInApi(ANA, {
      [UPCOMING]: async () => {
        await slow;
        return reply(200, list([summary({ id: 'u', title: 'Late upcoming answer' })]));
      },
      [PAST]: () => reply(200, list([summary({ id: 'p', title: 'Past answer' })])),
    });
    const { user } = renderApp({ api });
    const nav = await screen.findByRole('navigation', { name: 'Show' });
    await user.click(within(nav).getByRole('link', { name: 'Past' }));
    expect(await screen.findByRole('link', { name: 'Past answer' })).toBeTruthy();

    releaseUpcoming(); // the first request finishes only now
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: 'Late upcoming answer' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Past answer' })).toBeTruthy();
  });

  it('pages through long lists: ranges, links, and disabled ends', async () => {
    const api = signedInApi(ANA, {
      [UPCOMING]: () => reply(200, list(manyMeetings(20), { total: 45 })),
      'GET /api/v1/meetings?when=upcoming&limit=20&offset=40': () =>
        reply(200, list(manyMeetings(5), { offset: 40, total: 45 })),
    });
    const first = renderApp({ api });
    const nav = await screen.findByRole('navigation', { name: 'Pages' });
    expect(nav.textContent).toContain('Showing 1–20 of 45');
    expect(within(nav).getByRole('link', { name: 'Next' }).getAttribute('href')).toBe('/?page=2');
    expect(within(nav).getByText('Previous').getAttribute('aria-disabled')).toBe('true');
    first.unmount();

    renderApp({ api, route: '/?page=3' });
    const last = await screen.findByRole('navigation', { name: 'Pages' });
    expect(last.textContent).toContain('Showing 41–45 of 45');
    expect(within(last).getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe(
      '/?page=2',
    );
    expect(within(last).getByText('Next').getAttribute('aria-disabled')).toBe('true');
  });

  it('has no next page after the last full page when the total is an exact multiple', async () => {
    const api = signedInApi(ANA, {
      'GET /api/v1/meetings?when=upcoming&limit=20&offset=20': () =>
        reply(200, list(manyMeetings(20), { offset: 20, total: 40 })),
    });
    renderApp({ api, route: '/?page=2' });
    const nav = await screen.findByRole('navigation', { name: 'Pages' });
    expect(nav.textContent).toContain('Showing 21–40 of 40');
    expect(within(nav).getByText('Next').getAttribute('aria-disabled')).toBe('true');
    expect(within(nav).queryByRole('link', { name: 'Next' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe('/');
  });

  it('shows no pagination when everything fits on one page', async () => {
    renderApp({ api: signedInApi(ANA, { [UPCOMING]: () => reply(200, list(manyMeetings(3))) }) });
    await screen.findByRole('link', { name: 'Meeting 1' });
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('ignores invalid view and page values in the address', async () => {
    const api = signedInApi();
    renderApp({ api, route: '/?view=bogus&page=-3' });
    await screen.findByText('You have no upcoming meetings.');
    expect(
      api.calls.some((call) => call.path === '/api/v1/meetings?when=upcoming&limit=20&offset=0'),
    ).toBe(true);
    expect(api.unexpected).toEqual([]);
  });

  it('tells the user the list could not load, and retries on request', async () => {
    const api = signedInApi(ANA, {
      [UPCOMING]: sequence(
        apiError(500, 'internal_error'),
        reply(200, list([summary({ title: 'Back again' })])),
      ),
    });
    const { user } = renderApp({ api });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The information could not be loaded.',
    );
    expect(document.body.textContent).not.toContain('English message');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Back again' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains being offline and being rate limited', async () => {
    const offline = renderApp({
      api: signedInApi(ANA, {
        [UPCOMING]: () => {
          throw new TypeError('offline');
        },
      }),
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
    offline.unmount();

    renderApp({ api: signedInApi(ANA, { [UPCOMING]: () => apiError(429, 'rate_limited') }) });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Wait a few minutes and try again.',
    );
  });

  it('says which time zone the times are shown in', async () => {
    renderApp({ api: signedInApi() });
    expect((await screen.findByText(/Times are shown in your time zone/)).textContent).toMatch(
      /Buenos_Aires/,
    );
  });

  it('is available in Spanish, with plural forms', async () => {
    const api = signedInApi(ANA, {
      [UPCOMING]: () =>
        reply(
          200,
          list([
            summary({ title: 'Planificación', inviteeCount: 2 }),
            summary({ id: 'x', title: 'Otra', role: 'invitee', host: GUEST }),
          ]),
        ),
    });
    renderApp({ api, language: 'es' });
    expect(await screen.findByRole('heading', { name: 'Reuniones', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nueva reunión' })).toBeTruthy();
    const card = (await screen.findByRole('link', { name: 'Planificación' })).closest(
      'li',
    ) as HTMLElement;
    expect(card.textContent).toContain('2 invitados');
    expect(card.textContent).toContain('Anfitrión');
    expect(screen.getByRole('link', { name: 'Otra' }).closest('li')?.textContent).toContain(
      'Organiza Gus Guest',
    );
    expect(screen.getByRole('navigation', { name: 'Mostrar' })).toBeTruthy();
  });
});
