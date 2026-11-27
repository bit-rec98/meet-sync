import type { ServerMessage } from '@meet-sync/signaling-protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  PEER_A,
  PEER_B,
  SELF,
  createFakeEnvironment,
  peer,
  type FakeEnvironment,
} from '../test/callFakes';
import { apiError, reply, type Handler } from '../test/fakeApi';
import { HOST, hours, inFuture, meeting } from '../test/meetingFixtures';
import { ANA, renderApp, signedInApi } from '../test/render';

const GET = 'GET /api/v1/meetings/m1';
const TICKET = 'POST /api/v1/ws-tickets';
const ICE = 'GET /api/v1/ice-servers';

/** A meeting that is open for joining: it started 5 minutes ago. */
const openMeeting = (overrides = {}) =>
  meeting({
    id: 'm1',
    title: 'Planning',
    startsAt: inFuture(-hours(5 / 60)),
    durationMinutes: 60,
    callType: 'video',
    role: 'invitee',
    host: HOST,
    ...overrides,
  });

function open(
  options: {
    meeting?: ReturnType<typeof meeting>;
    routes?: Record<string, Handler>;
    language?: 'en' | 'es';
    strict?: boolean;
  } = {},
) {
  const environment = createFakeEnvironment();
  const api = signedInApi(ANA, {
    [GET]: () => reply(200, options.meeting ?? openMeeting()),
    [TICKET]: () => reply(201, { ticket: 'ticket-1', expiresInSeconds: 30 }),
    [ICE]: () => reply(200, { iceServers: [{ urls: ['stun:stun.example:3478'] }] }),
    ...options.routes,
  });
  const view = renderApp({
    api,
    route: '/meetings/m1/call',
    callEnvironment: environment,
    ...(options.language ? { language: options.language } : {}),
    ...(options.strict ? { strict: true } : {}),
  });
  return { ...view, environment };
}

const emit = (environment: FakeEnvironment, message: ServerMessage) =>
  act(async () => environment.channel.emit(message));

/** Opens the screen, joins with the camera, and lets the server admit the user. */
async function inCall(
  options: Parameters<typeof open>[0] = {},
  others = [peer(PEER_A, 'Ben Brown')],
) {
  const context = open(options);
  await context.user.click(
    await screen.findByRole('button', { name: 'Join with camera and microphone' }),
  );
  await waitFor(() => expect(context.environment.channel.sent.length).toBeGreaterThan(0));
  await emit(context.environment, { type: 'joined', selfId: SELF, peers: others });
  await screen.findByRole('group', { name: 'Call controls' });
  return context;
}

const heading = (name: string) => screen.findByRole('heading', { name, level: 1 });

describe('the lobby', () => {
  it('offers camera or microphone-only joining for a video meeting', async () => {
    open();
    await heading('Planning');
    expect(screen.getByRole('heading', { name: 'Ready to join?' })).toBeTruthy();
    expect(screen.getByText(/ask for access to your microphone and camera/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join with camera and microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join with microphone only' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the meeting' }).getAttribute('href')).toBe(
      '/meetings/m1',
    );
  });

  it('offers only the microphone for an audio meeting', async () => {
    open({ meeting: openMeeting({ callType: 'audio' }) });
    await heading('Planning');
    expect(screen.getByRole('button', { name: 'Join with microphone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /camera/ })).toBeNull();
  });

  it('asks for nothing before the user chooses to join', async () => {
    const { environment, api } = open();
    await heading('Planning');
    expect(environment.mediaRequests).toEqual([]);
    expect(api.calls.some((call) => call.path.includes('ws-tickets'))).toBe(false);
  });

  it('says when joining opens, instead of offering it, for a meeting that is far away', async () => {
    open({ meeting: openMeeting({ startsAt: inFuture(hours(5)) }) });
    await heading('Planning');
    expect(screen.getByText(/^You can join from .+\.$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('says so for a cancelled or finished meeting', async () => {
    const cancelled = open({ meeting: openMeeting({ status: 'cancelled' }) });
    await heading('Planning');
    expect(screen.getByText('This meeting was cancelled.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
    cancelled.unmount();

    open({ meeting: openMeeting({ startsAt: inFuture(-hours(3)) }) });
    await heading('Planning');
    expect(screen.getByText('This meeting is over, so it can no longer be joined.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('shows why the meeting could not be loaded', async () => {
    open({ routes: { [GET]: () => apiError(404, 'not_found') } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });
});

describe('joining', () => {
  it('asks for camera and microphone, gets a ticket, and shows "connecting" meanwhile', async () => {
    const { environment, api, user } = open();
    await user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );

    await waitFor(() =>
      expect(environment.channel.sent).toEqual([{ type: 'join', media: 'video' }]),
    );
    expect(environment.mediaRequests[0]?.video).toBeTruthy();
    expect(api.calls.find((call) => call.path === '/api/v1/ws-tickets')?.body).toEqual({
      meetingId: 'm1',
    });
    expect(environment.tickets).toEqual(['ticket-1']);
    expect(screen.getByRole('button', { name: 'Connecting…' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Join with microphone only' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('joins with the microphone only when asked', async () => {
    const { environment, user } = open();
    await user.click(await screen.findByRole('button', { name: 'Join with microphone only' }));
    await waitFor(() =>
      expect(environment.channel.sent).toEqual([{ type: 'join', media: 'audio' }]),
    );
    expect(environment.mediaRequests[0]?.video).toBe(false);
  });

  it('shows you and everyone already there once admitted', async () => {
    await inCall({}, [peer(PEER_A, 'Ben Brown'), peer(PEER_B, 'Cleo Cruz', 'audio')]);
    const tiles = within(screen.getByRole('list', { name: 'Participants' })).getAllByRole(
      'listitem',
    );
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining('Ana García (you)'),
      expect.stringContaining('Ben Brown'),
      expect.stringContaining('Cleo Cruz'),
    ]);
    expect(screen.getByText('3 people in the call')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn camera off' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  });

  it('says so when nobody else is there yet', async () => {
    await inCall({}, []);
    expect(screen.getByText('You are the only one here for now.')).toBeTruthy();
  });

  it('plays the voice of someone without a camera, and shows their stream when they have one', async () => {
    const { environment } = await inCall({}, [peer(PEER_A, 'Ben Brown')]);
    expect(document.querySelectorAll('video')).toHaveLength(2);
    const stream = environment.streams[0]!;
    const own = [...document.querySelectorAll('video')][0]!;
    expect(own.muted).toBe(true); // you do not hear yourself
    expect((own as HTMLVideoElement & { srcObject: unknown }).srcObject).toBe(stream);
    expect([...document.querySelectorAll('video')][1]!.muted).toBe(false);
  });
});

describe('during the call', () => {
  it('muting changes the button, the tile and tells the others', async () => {
    const { environment, user } = await inCall();
    await user.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(screen.getByRole('button', { name: 'Turn microphone on' })).toBeTruthy();
    expect(environment.streams[0]?.getAudioTracks()[0]?.enabled).toBe(false);
    expect(environment.channel.sentOfType('media-state').at(-1)).toEqual({
      type: 'media-state',
      audioEnabled: false,
      videoEnabled: true,
    });
    const own = screen.getAllByRole('listitem')[0]!;
    expect(own.textContent).toContain('Microphone off');

    await user.click(screen.getByRole('button', { name: 'Turn microphone on' }));
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
  });

  it('turning the camera off changes the button and the tile', async () => {
    const { environment, user } = await inCall();
    await user.click(screen.getByRole('button', { name: 'Turn camera off' }));
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeTruthy();
    expect(environment.streams[0]?.getVideoTracks()[0]?.enabled).toBe(false);
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('Camera off');
  });

  it('has no camera button when joined with the microphone only', async () => {
    const context = open();
    await context.user.click(
      await screen.findByRole('button', { name: 'Join with microphone only' }),
    );
    await waitFor(() => expect(context.environment.channel.sent.length).toBe(1));
    await emit(context.environment, { type: 'joined', selfId: SELF, peers: [] });
    await screen.findByRole('group', { name: 'Call controls' });
    expect(screen.queryByRole('button', { name: /camera/i })).toBeNull();
  });

  it('shows when others mute or turn their camera off, and their connection problems', async () => {
    const { environment } = await inCall();
    await emit(environment, {
      type: 'peer-media-state',
      peerId: PEER_A,
      audioEnabled: false,
      videoEnabled: false,
    });
    const ben = () => screen.getAllByRole('listitem')[1]!.textContent ?? '';
    expect(ben()).toContain('Microphone off');
    expect(ben()).toContain('Camera off');

    await act(async () => environment.connections[0]!.setConnectionState('failed'));
    expect(ben()).toContain('Connection problem');
  });

  it('announces arrivals and departures politely, without moving focus', async () => {
    const { environment } = await inCall({}, []);
    const live = screen
      .getAllByRole('status')
      .find((node) => node.getAttribute('aria-live') === 'polite')!;
    const before = document.activeElement;

    await emit(environment, { type: 'peer-joined', peer: peer(PEER_A, 'Ben Brown') });
    expect(live.textContent).toBe('Ben Brown joined the call.');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    await emit(environment, { type: 'peer-left', peerId: PEER_A });
    expect(live.textContent).toBe('Ben Brown left the call.');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(document.activeElement).toBe(before);
  });
});

describe('when the call ends', () => {
  it('leaving shows the end and lets the user rejoin from the lobby', async () => {
    const { environment, user } = await inCall();
    await user.click(screen.getByRole('button', { name: 'Leave call' }));

    expect(environment.channel.sentOfType('leave')).toHaveLength(1);
    const ended = await heading('The call has ended for you');
    expect(document.activeElement).toBe(ended); // the reason is read out
    expect(screen.getByText('You left the call.')).toBeTruthy();
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Rejoin' }));
    expect(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    ).toBeTruthy();
  });

  it.each([
    ['replaced', 'You joined this call from another tab or device, which replaced this one.', true],
    ['server_shutdown', 'The service is restarting. Try joining again in a moment.', true],
    ['removed', 'The host removed you from the meeting.', false],
    ['meeting_cancelled', 'The host cancelled the meeting.', false],
  ] as const)('explains "%s" and %s offering to rejoin', async (reason, text, canRejoin) => {
    const { environment } = await inCall();
    await emit(environment, { type: 'bye', reason });
    expect(await heading('The call has ended for you')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(!!screen.queryByRole('button', { name: 'Rejoin' })).toBe(canRejoin);
    expect(screen.getByRole('link', { name: 'Back to the meeting' })).toBeTruthy();
  });

  it('explains a lost connection', async () => {
    const { environment } = await inCall();
    await act(async () => environment.channel.emitClose(1006));
    expect(await screen.findByText('The connection was lost.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejoin' })).toBeTruthy();
  });

  it('explains a full room, and a refused join', async () => {
    const full = open();
    await full.user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    await waitFor(() => expect(full.environment.channel.sent.length).toBe(1));
    await emit(full.environment, { type: 'error', code: 'room_full' });
    expect(
      await screen.findByText('The call is full. Try again when someone leaves.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejoin' })).toBeTruthy();
    full.unmount();

    const refused = open();
    await refused.user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    await waitFor(() => expect(refused.environment.channel.sent.length).toBe(1));
    await emit(refused.environment, { type: 'error', code: 'not_allowed' });
    expect(await screen.findByText('You cannot join this call.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rejoin' })).toBeNull();
  });

  it('starts over with a fresh session when rejoining', async () => {
    const { environment, user } = await inCall();
    await emit(environment, { type: 'bye', reason: 'server_shutdown' });
    await user.click(await screen.findByRole('button', { name: 'Rejoin' }));
    await user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    await waitFor(() => expect(environment.mediaRequests).toHaveLength(2));
    await waitFor(() => expect(environment.channel.sentOfType('join')).toHaveLength(2));
  });
});

describe('when joining fails', () => {
  const failure = (name: string) => Object.assign(new Error(name), { name });

  it.each([
    ['NotAllowedError', 'The browser does not allow access to your microphone or camera.'],
    ['NotFoundError', 'No microphone or camera was found.'],
    ['NotReadableError', 'Your microphone or camera could not be started.'],
  ])('explains a camera problem (%s) in the lobby and allows trying again', async (name, text) => {
    const { environment, user } = open();
    environment.failMedia(failure(name));
    await user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(
      screen
        .getByRole('button', { name: 'Join with camera and microphone' })
        .hasAttribute('disabled'),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Join with camera and microphone' }));
    await waitFor(() => expect(environment.channel.sent).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [409, 'invalid_state', 'You cannot join this call right now.'],
    [404, 'not_found', 'You cannot join this call right now.'],
    [429, 'rate_limited', 'Too many attempts. Wait a moment and try again.'],
  ])('explains a refused ticket (%i %s)', async (status, code, text) => {
    const { environment, user } = open({ routes: { [TICKET]: () => apiError(status, code) } });
    await user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(environment.tickets).toEqual([]);
  });

  it('explains a signaling connection that cannot be opened', async () => {
    const { environment, user } = open();
    environment.failSignaling();
    await user.click(
      await screen.findByRole('button', { name: 'Join with camera and microphone' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The connection to the call could not be made.',
    );
  });
});

describe('leaving the screen', () => {
  it('ends the call and releases the camera and microphone', async () => {
    const { environment, unmount } = await inCall();
    unmount();
    await waitFor(() => expect(environment.channel.closed).toBe(true));
    expect(environment.channel.sentOfType('leave')).toHaveLength(1);
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(environment.connections[0]?.closed).toBe(true);
  });

  it('keeps working under React StrictMode, which mounts everything twice in development', async () => {
    const { environment } = await inCall({ strict: true });
    expect(environment.channel.closed).toBe(false);
    expect(environment.streams[0]?.tracks.some((track) => track.stopped)).toBe(false);
    expect(screen.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  });
});

describe('in Spanish', () => {
  it('shows the lobby, the call and the end in Spanish', async () => {
    const { environment, user } = open({ language: 'es' });
    await user.click(await screen.findByRole('button', { name: 'Unirme con cámara y micrófono' }));
    await waitFor(() => expect(environment.channel.sent.length).toBe(1));
    await emit(environment, { type: 'joined', selfId: SELF, peers: [peer(PEER_A, 'Ben Brown')] });

    expect(await screen.findByRole('group', { name: 'Controles de la llamada' })).toBeTruthy();
    expect(screen.getByText('2 personas en la llamada')).toBeTruthy();
    expect(screen.getByText('Ana García (tú)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Silenciar micrófono' }));
    expect(screen.getByRole('button', { name: 'Activar micrófono' })).toBeTruthy();

    await emit(environment, { type: 'bye', reason: 'meeting_cancelled' });
    expect(await screen.findByText('El anfitrión canceló la reunión.')).toBeTruthy();
  });
});
