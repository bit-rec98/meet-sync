import { screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { apiError, reply, sequence, type Handler } from '../test/fakeApi';
import {
  GUEST,
  HOST,
  days,
  hours,
  inFuture,
  invitee,
  list,
  meeting,
} from '../test/meetingFixtures';
import { ANA, UPCOMING, renderApp, signedInApi } from '../test/render';

const GET = 'GET /api/v1/meetings/m1';
const INVITE = 'POST /api/v1/meetings/m1/invitees';
const CANCEL = 'DELETE /api/v1/meetings/m1';
const REMOVE_GUEST = `DELETE /api/v1/meetings/m1/invitees/${GUEST.id}`;
const LEAVE = `DELETE /api/v1/meetings/m1/invitees/${ANA.id}`;

const callsTo = (api: { calls: { method: string; path: string }[] }, route: string): number =>
  api.calls.filter((call) => `${call.method} ${call.path}` === route).length;

const guestWithEmail = invitee(GUEST, 'guest@example.test');

/** A meeting the signed-in user hosts, with one invitee, two days ahead. */
const hosted = (overrides = {}) =>
  meeting({
    id: 'm1',
    title: 'Planning',
    description: 'Line one\nLine two',
    startsAt: '2030-03-01T15:00:00.000Z',
    durationMinutes: 90,
    role: 'host',
    host: { id: ANA.id, displayName: ANA.displayName },
    invitees: [guestWithEmail],
    ...overrides,
  });

/** The same meeting as an invitee sees it: no emails. */
const asInvitee = (overrides = {}) =>
  hosted({
    role: 'invitee',
    host: HOST,
    invitees: [invitee(GUEST), invitee({ id: ANA.id, displayName: ANA.displayName })],
    ...overrides,
  });

const open = (
  get: Handler,
  extra: Record<string, Handler> = {},
  options: { language?: 'en' | 'es' } = {},
) =>
  renderApp({ api: signedInApi(ANA, { [GET]: get, ...extra }), route: '/meetings/m1', ...options });

const email = () => screen.getByLabelText('Email of a registered user') as HTMLInputElement;
const describedBy = (element: HTMLElement): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('meeting details as the host', () => {
  it('shows everything about the meeting, including the invitees’ emails', async () => {
    open(() => reply(200, hosted()));
    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();

    const body = document.body.textContent ?? '';
    expect(body).toContain('Friday, March 1, 2030'); // the long date, in the user's language and zone
    expect(body).toContain('12:00');
    expect(body).toContain('1 h 30 min');
    expect(body).toContain('Video call');
    expect(body).toContain('Line one\nLine two');
    expect(screen.getByRole('link', { name: 'Back to meetings' }).getAttribute('href')).toBe('/');

    const invitees = screen.getByRole('region', { name: 'Invitees' });
    expect(within(invitees).getByText('Gus Guest')).toBeTruthy();
    expect(within(invitees).getByText('guest@example.test')).toBeTruthy();
    expect(within(invitees).getByRole('button', { name: 'Remove Gus Guest' })).toBeTruthy();
  });

  it('offers Edit, Cancel and Invite while the meeting is still to come', async () => {
    open(() => reply(200, hosted({ startsAt: inFuture(days(2)) })));
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe(
      '/meetings/m1/edit',
    );
    expect(screen.getByRole('button', { name: 'Cancel meeting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByText('Joining calls will be available soon.')).toBeTruthy();
  });

  it('shows the time zone the time is in', async () => {
    open(() => reply(200, hosted()));
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    expect(document.body.textContent).toMatch(
      /Times are shown in your time zone \(.*Buenos_Aires\)/,
    );
  });

  it('removes Edit once the meeting started, but still allows cancelling and inviting until it ends', async () => {
    open(() => reply(200, hosted({ startsAt: inFuture(-hours(0.5)), durationMinutes: 60 })));
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel meeting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('offers nothing to change once the meeting is over or cancelled, but invitees can still be removed', async () => {
    for (const closed of [
      hosted({ startsAt: inFuture(-hours(3)), durationMinutes: 60 }),
      hosted({ status: 'cancelled', startsAt: inFuture(days(1)) }),
    ]) {
      const view = open(() => reply(200, closed));
      await screen.findByRole('heading', { name: 'Planning', level: 1 });
      expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel meeting' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
      expect(screen.queryByText('Joining calls will be available soon.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove Gus Guest' })).toBeTruthy();
      view.unmount();
    }
  });

  it('says there are no invitees yet', async () => {
    open(() => reply(200, hosted({ invitees: [] })));
    expect(await screen.findByText('Nobody has been invited yet.')).toBeTruthy();
  });
});

describe('meeting details as an invitee', () => {
  it('shows the meeting without any email address, or any host controls', async () => {
    open(() => reply(200, asInvitee({ startsAt: inFuture(days(2)) })));
    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();

    expect(document.body.textContent).not.toContain('@');
    expect(screen.getByText('Hana Host')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel meeting' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave meeting' })).toBeTruthy();
  });
});

describe('inviting', () => {
  it('invites by email, announces it, refreshes the list, and clears the field', async () => {
    const view = open(
      sequence(
        reply(200, hosted({ invitees: [] })),
        reply(200, hosted({ invitees: [guestWithEmail] })),
      ),
      { [INVITE]: () => reply(201, guestWithEmail) },
    );
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    await view.user.type(email(), '  guest@example.test ');
    await view.user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('Gus Guest was invited.')).toBeTruthy();
    expect(await screen.findByText('guest@example.test')).toBeTruthy();
    expect(
      view.api.calls.find((call) => call.path === '/api/v1/meetings/m1/invitees')?.body,
    ).toEqual({
      email: 'guest@example.test',
    });
    expect(email().value).toBe('');
    expect(screen.getByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy(); // no blink to a loading page
  });

  it('checks the email in the browser first', async () => {
    const view = open(() => reply(200, hosted()));
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    await view.user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(describedBy(email())).toBe('Enter your email address.');
    await view.user.type(email(), 'nope');
    await view.user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(describedBy(email())).toBe('Enter a valid email address.');
    expect(callsTo(view.api, INVITE)).toBe(0);
  });

  it('explains each way an invitation can be refused, on the email field or the form', async () => {
    const cases: [ReturnType<typeof apiError>, string, 'field' | 'form'][] = [
      [apiError(404, 'user_not_found'), 'No registered user has this email address.', 'field'],
      [apiError(409, 'already_invited'), 'This person is already part of the meeting.', 'field'],
      [
        apiError(409, 'invitee_limit_reached'),
        'The meeting already has the maximum number of invitees.',
        'form',
      ],
      [
        apiError(409, 'invalid_state'),
        'The meeting changed and this is no longer possible. Reload the page to see its current state.',
        'form',
      ],
      [
        apiError(429, 'rate_limited'),
        'Too many attempts. Wait a few minutes and try again.',
        'form',
      ],
    ];
    for (const [failure, message, where] of cases) {
      const view = open(() => reply(200, hosted()), { [INVITE]: () => failure });
      await screen.findByRole('heading', { name: 'Planning', level: 1 });
      await view.user.type(email(), 'someone@example.test');
      await view.user.click(screen.getByRole('button', { name: 'Invite' }));
      if (where === 'field') {
        await waitFor(() => expect(email().getAttribute('aria-invalid')).toBe('true'));
        expect(describedBy(email())).toBe(message);
        expect(document.activeElement).toBe(email());
      } else {
        expect((await screen.findByRole('alert')).textContent).toBe(message);
      }
      expect(document.body.textContent).not.toContain('English message');
      view.unmount();
    }
  });
});

describe('removing an invitee', () => {
  it('removes the person, announces it, refreshes the list, and moves focus to the section', async () => {
    const view = open(sequence(reply(200, hosted()), reply(200, hosted({ invitees: [] }))), {
      [REMOVE_GUEST]: () => reply(204),
    });
    await view.user.click(await screen.findByRole('button', { name: 'Remove Gus Guest' }));

    expect(await screen.findByText('Gus Guest was removed.')).toBeTruthy();
    expect(await screen.findByText('Nobody has been invited yet.')).toBeTruthy();
    expect(callsTo(view.api, REMOVE_GUEST)).toBe(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invitees' }));
  });

  it('tells the host when the removal failed, and keeps the person listed', async () => {
    const view = open(() => reply(200, hosted()), {
      [REMOVE_GUEST]: () => apiError(404, 'not_found'),
    });
    await view.user.click(await screen.findByRole('button', { name: 'Remove Gus Guest' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This meeting does not exist, or you do not have access to it.',
    );
    expect(screen.getByText('Gus Guest')).toBeTruthy();
  });
});

describe('cancelling the meeting', () => {
  it('asks first, in place, with focus on the question; declining returns focus to the button', async () => {
    const view = open(() => reply(200, hosted({ startsAt: inFuture(days(2)) })));
    const cancel = await screen.findByRole('button', { name: 'Cancel meeting' });
    await view.user.click(cancel);

    const panel = screen.getByRole('region', { name: 'Cancel this meeting?' });
    expect(document.activeElement).toBe(
      within(panel).getByRole('heading', { name: 'Cancel this meeting?' }),
    );
    expect(panel.textContent).toContain('Everyone invited will see it as cancelled.');
    expect(callsTo(view.api, CANCEL)).toBe(0);

    await view.user.click(within(panel).getByRole('button', { name: 'Keep meeting' }));
    expect(screen.queryByRole('region', { name: 'Cancel this meeting?' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel meeting' }));
    expect(callsTo(view.api, CANCEL)).toBe(0);
  });

  it('cancels on confirmation, announces it, and then offers nothing to change', async () => {
    const open2 = hosted({ startsAt: inFuture(days(2)) });
    const view = open(sequence(reply(200, open2), reply(200, { ...open2, status: 'cancelled' })), {
      [CANCEL]: () => reply(204),
    });
    await view.user.click(await screen.findByRole('button', { name: 'Cancel meeting' }));
    await view.user.click(screen.getByRole('button', { name: 'Yes, cancel meeting' }));

    expect(await screen.findByText('Meeting cancelled.')).toBeTruthy();
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel meeting' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(callsTo(view.api, CANCEL)).toBe(1);
  });

  it('keeps the question open and explains when the server refuses', async () => {
    const view = open(() => reply(200, hosted({ startsAt: inFuture(days(2)) })), {
      [CANCEL]: () => apiError(409, 'invalid_state'),
    });
    await view.user.click(await screen.findByRole('button', { name: 'Cancel meeting' }));
    await view.user.click(screen.getByRole('button', { name: 'Yes, cancel meeting' }));

    const panel = screen.getByRole('region', { name: 'Cancel this meeting?' });
    expect((await within(panel).findByRole('alert')).textContent).toContain('The meeting changed');
  });

  it('sends the request only once while it is running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const view = open(() => reply(200, hosted({ startsAt: inFuture(days(2)) })), {
      [CANCEL]: async () => {
        await gate;
        return reply(204);
      },
    });
    await view.user.click(await screen.findByRole('button', { name: 'Cancel meeting' }));
    const confirm = screen.getByRole('button', { name: 'Yes, cancel meeting' });
    await view.user.click(confirm);
    await view.user.click(confirm);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(callsTo(view.api, CANCEL)).toBe(1);
    release();
    await screen.findByText('Meeting cancelled.');
  });
});

describe('leaving a meeting', () => {
  it('asks first, then removes the user and returns to the list with a notice', async () => {
    const view = open(() => reply(200, asInvitee({ startsAt: inFuture(days(2)) })), {
      [LEAVE]: () => reply(204),
      [UPCOMING]: () => reply(200, list([])),
    });
    await view.user.click(await screen.findByRole('button', { name: 'Leave meeting' }));
    expect(screen.getByRole('region', { name: 'Leave this meeting?' })).toBeTruthy();
    expect(callsTo(view.api, LEAVE)).toBe(0);

    await view.user.click(screen.getByRole('button', { name: 'Yes, leave' }));
    expect(await screen.findByRole('heading', { name: 'Meetings', level: 1 })).toBeTruthy();
    expect(await screen.findByText('You left the meeting.')).toBeTruthy();
    expect(callsTo(view.api, LEAVE)).toBe(1);
  });

  it('lets an invitee decline to leave', async () => {
    const view = open(() => reply(200, asInvitee({ startsAt: inFuture(days(2)) })));
    await view.user.click(await screen.findByRole('button', { name: 'Leave meeting' }));
    await view.user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('region', { name: 'Leave this meeting?' })).toBeNull();
    expect(callsTo(view.api, LEAVE)).toBe(0);
  });
});

describe('when the meeting cannot be shown', () => {
  it('explains a meeting that does not exist, with the same message as one the user may not see', async () => {
    open(() => apiError(404, 'not_found'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This meeting does not exist, or you do not have access to it.',
    );
    expect(screen.getByRole('link', { name: 'Back to meetings' }).getAttribute('href')).toBe('/');
  });

  it('offers to try again after a failure', async () => {
    const view = open(sequence(apiError(500, 'internal_error'), reply(200, hosted())));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The information could not be loaded.',
    );
    await view.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();
  });

  it('shows a notice sent by the previous page, and removes it from the history so a reload will not repeat it', async () => {
    function StateProbe() {
      const location = useLocation();
      return <output aria-label="history state">{JSON.stringify(location.state)}</output>;
    }
    renderApp({
      api: signedInApi(ANA, { [GET]: () => reply(200, hosted({ startsAt: inFuture(days(2)) })) }),
      route: '/meetings/m1',
      state: { notice: 'created' },
      extra: <StateProbe />,
    });

    expect(await screen.findByText('Meeting scheduled.')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('history state').textContent).toBe('null'));
    expect(screen.getByText('Meeting scheduled.')).toBeTruthy(); // still shown on this page
  });

  it('ignores router state that is not a known notice', async () => {
    renderApp({
      api: signedInApi(ANA, { [GET]: () => reply(200, hosted({ startsAt: inFuture(days(2)) })) }),
      route: '/meetings/m1',
      state: { notice: '<img src=x onerror=alert(1)>' },
    });
    await screen.findByRole('heading', { name: 'Planning', level: 1 });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('in Spanish', () => {
  it('translates the details, the confirmation and the notices', async () => {
    const view = open(
      () => reply(200, hosted({ startsAt: inFuture(days(2)) })),
      { [CANCEL]: () => reply(204) },
      { language: 'es' },
    );
    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeTruthy();
    expect(screen.getByText('Cuándo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Invitados' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar a Gus Guest' })).toBeTruthy();

    await view.user.click(screen.getByRole('button', { name: 'Cancelar reunión' }));
    expect(screen.getByRole('region', { name: '¿Cancelar esta reunión?' })).toBeTruthy();
    await view.user.click(screen.getByRole('button', { name: 'Sí, cancelar la reunión' }));
    expect(await screen.findByText('Se canceló la reunión.')).toBeTruthy();
  });
});
