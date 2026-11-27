# MeetSync

A meeting suite for work teams: schedule, manage, and hold audio and video meetings in the browser.
It is also a learning project for **WebSockets** and **WebRTC**.

## Status

**Early development.** The project was restarted from scratch after the previous implementation
was lost.

**Implemented:** accounts and meetings, through the REST API (with rate limiting) and a web interface in
English and Spanish; the **signaling server** (WebSocket, tickets, rooms); and the **call screen** (camera,
microphone, one WebRTC connection per participant, mute and camera controls).
**Not implemented yet:** everything under "Planned features". Calls have been tried with real browsers
(Chrome) on one machine; they have not been tried across different networks, with a TURN server, or in
Firefox and Safari.

## Features

- Accounts: register, log in, log out, session refresh. See [Authentication](#authentication).
- Meetings: schedule, edit, cancel and list meetings; invite registered users by email; invitees can
  leave. See [Meetings](#meetings).
- Web app: screens for all of the above, in English and Spanish. See [Web app](#web-app).
- Signaling server: the part of a call that goes through the server (who is in the call, and relaying
  the messages browsers need to connect to each other). See [Calls](#calls-signaling-server).
- Call screen: join a meeting's call with camera and microphone (or microphone only), with mute and camera
  controls. See [The call screen](#the-call-screen).

## Planned features

- Public deployment (the web app as a static site, the API and database on free hosting), with a TURN server
  for people behind restrictive networks.
- Ending a meeting for everyone, and reconnecting automatically after a dropped connection.

Out of scope for the first version: text chat, screen sharing, recording, guest access, video calls
above the video participant limit.

## Technology stack

| Area             | Technology                                                                                   | In the code today     |
| ---------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| Frontend         | React, Vite, TypeScript, Tailwind CSS, React Router, i18next                                 | Yes (accounts)        |
| Backend          | Node.js, Express, TypeScript                                                                 | Yes (health, auth)    |
| WebSockets       | `ws`, shared message schemas in `packages/signaling-protocol`                                | Yes (signaling)       |
| Database         | MySQL (local via Docker), `mysql2`                                                           | Yes (users, sessions) |
| Real-time media  | WebRTC (peer-to-peer mesh)                                                                   | Not yet               |
| Frontend hosting | Netlify (the backend runs on a separate host that supports long-lived WebSocket connections) | Not yet               |

## Architecture overview

- **Media** (audio/video) travels directly between browsers over WebRTC, encrypted with DTLS-SRTP.
  It does not pass through the application server (a TURN relay is used only when a direct
  connection is impossible).
- **WebSockets** carry _signaling_: presence (who joined or left) and the messages peers
  exchange to set up WebRTC connections.
- **REST over HTTPS** handles accounts, authentication, and meeting management.
- **MySQL** stores users, meetings, and invitations. It stores no call content.
- The API and the signaling server run as one Node process; the React app is a static site.

## Prerequisites

- Node.js 26 or newer (`.nvmrc`; developed and verified on 26.13.0) and npm.
- Docker with Compose, for the local MySQL database.

## Setup

```bash
git clone https://github.com/bit-rec98/meet-sync.git
cd meet-sync
npm ci
cp .env.example .env          # then replace every placeholder password in .env
docker compose up -d --wait   # starts MySQL on 127.0.0.1:3307
npm run migrate -w @meet-sync/api   # creates the schema in the development database
```

Configuration is documented in [`.env.example`](.env.example). Required variables have no default;
the API refuses to start if one is missing or invalid. Generate the access-token signing key with
`openssl rand -hex 32` and put it in `JWT_ACCESS_SECRET`.

The local database has three accounts, created on the first start of the container:

- **Runtime account** (`DB_USER`): used by the API; can only read and write rows, cannot change the schema.
- **Migration account** (`DB_MIGRATION_USER`): used only by `npm run migrate`; full rights on the application and test databases.
- **Root** (`DB_ROOT_PASSWORD`): used only inside the container.

The account setup script runs only when the data volume is created. After changing database names or
passwords in `.env`, recreate the volume with `docker compose down -v` (this deletes local data).

## Running

```bash
npm run dev:api   # API on http://localhost:3000, health check at /api/v1/health
npm run dev:web   # web app on http://localhost:5173, proxies /api to the API
```

## Trying the app with test users

Registering is limited to 5 accounts per hour per address, and a call needs at least two people, so the
repository has a command that creates a ready-made set of accounts and meetings in your **local** database:

```bash
docker compose up -d --wait         # the database
npm run migrate -w @meet-sync/api   # once, if you have not already
npm run seed                        # creates the test accounts and meetings (safe to repeat)
npm run dev:api                     # and, in another terminal, npm run dev:web
```

All five accounts use the password **`meetsync-dev-password`**. It is published here on purpose and is only
meant for your own machine: the command refuses to run unless `NODE_ENV` is `development`, the database is on
this machine, and it is not the automated tests' database. It is not part of the production build.

| Account (`@example.test`) | Hosts                                                                    | Is invited to                                                        |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `ana`                     | stand-up, quarterly planning, lunch, retrospective, kick-off, 22 samples | check-in, design review, offsite                                     |
| `ben`                     | check-in, offsite                                                        | stand-up, design review, quarterly planning, retrospective, kick-off |
| `cleo`                    | design review                                                            | stand-up, check-in, quarterly planning, retrospective, offsite       |
| `dan`                     | hiring sync (Ana cannot see it)                                          | stand-up, quarterly planning                                         |
| `eli`                     | nothing                                                                  | stand-up, check-in, hiring sync                                      |

The meetings cover every state, and each title says which one it is: _Joinable now_ (a video and an audio
meeting that start in a few minutes), _In progress_, _Later_ (joining not open yet; one with nobody
invited), _Finished_ (one over by time, one marked as ended), _Cancelled_, and 22 _Sample meeting_ entries
that give Ana a second page of upcoming meetings. Times are relative to when you ran the command, so
the "joinable now" meetings become "in progress" and then "finished": run `npm run seed` again to get fresh
ones. It replaces the seed meetings and resets the accounts' names and passwords; meetings you made yourself
are left alone.

**To try a call**, use two browser profiles (or a normal and a private window): the session is per browser
profile, so two tabs of one profile are the same person. Sign in as `ana@example.test` in one and
`ben@example.test` in the other, open _Joinable now: team stand-up_ in both and press **Join call**. The
stand-up has four invitees, so with four people in it the fifth (`eli`) is told the call is full. Without a
camera, start Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. The camera
works only on `localhost` or `https`.

`npm run seed:remove` deletes the five accounts and **every meeting they host**, including ones you made
with them by hand (a meeting cannot outlive its host).

## Authentication

The REST API (base path `/api/v1/auth`) is described in [`apps/api/openapi.yaml`](apps/api/openapi.yaml).

- **Passwords:** 12 to 128 characters, hashed with Argon2id. Plain passwords are never stored or logged.
- **Access token:** a JWT valid for 15 minutes, sent as `Authorization: Bearer <token>` and kept in memory by the client.
- **Refresh token:** an opaque random value in an `HttpOnly`, `SameSite=Strict` cookie limited to `/api/v1/auth`
  (`Secure` in production). It is stored only as a SHA-256 hash and rotated on every use. Presenting a token
  that was already rotated revokes that whole session.
- **Rate limits** (in memory, per API process): 5 registrations per hour per address; failed logins are limited
  to 10 per 15 minutes per address and 5 per 15 minutes per email; 30 refreshes per 15 minutes per address.
  Behind a reverse proxy, set `TRUST_PROXY_HOPS` so limits apply to real client addresses.
- **Not included yet:** email verification, password reset, multi-factor authentication.

## Web app

Run it with `npm run dev:web` (the API must be running too; see [Running](#running)). In development the
Vite server proxies `/api` to the API, so the browser sees one origin and the refresh cookie works as in production.

- **Screens:**
  - Log in and create account.
  - The meetings list (`/`): upcoming and past views and pages are kept in the address, so the back button
    and bookmarks work. Each meeting shows its time in the user's own time zone, duration, call type, role
    (host or invitee) and, when relevant, "In progress", "Finished" or "Cancelled".
  - Schedule (`/meetings/new`) and edit (`/meetings/:id/edit`) with one shared form. An edit sends only the
    fields that changed.
  - Meeting details (`/meetings/:id`): the host can edit (until the meeting starts), cancel and invite
    (until it ends), and remove invitees; an invitee can leave. Cancelling and leaving ask for confirmation
    first. Invitee emails are visible to the host only.
  - A **Join call** button appears on the meeting details from 15 minutes before the start until the end;
    before that, the page says when joining opens. It opens the call screen (`/meetings/:id/call`).
- **Times:** the form's date and time are read in the user's time zone and sent to the API as UTC; the buttons
  shown follow the same rules as the API, which stays the authority (a stale page gets a translated message).
- **Languages:** English and Spanish. The first visit uses the browser's language; the choice made with the
  language selector is remembered in `localStorage` (a preference, not a secret). Every text is in
  `apps/web/src/i18n/locales/`; a test fails if a text exists in only one language. API errors are shown with
  translated texts chosen by error code, never with the API's own messages.
- **Session:** the access token is kept in memory only (never in `localStorage`). When the page loads, the app asks
  the API for a new access token using the `HttpOnly` refresh cookie, so a reload keeps the user signed in. Refresh
  requests are serialized (also across tabs, where the browser supports the Web Locks API), because the API treats
  a second use of an already-rotated cookie as theft and ends the session.
- **Styling:** Tailwind CSS with a dark theme. Colors are tokens in `apps/web/src/index.css` with their contrast
  ratios documented next to them.
- **Accessibility:** labelled fields, errors linked to their field and announced, focus moved to the first invalid
  field, a skip link, landmarks, and the page language following the selected language. Not yet tested with a screen reader.

## Meetings

The REST API (base path `/api/v1/meetings`, also in [`apps/api/openapi.yaml`](apps/api/openapi.yaml)) needs
a valid access token on every route.

- **Who can see and change what:** a meeting is visible only to its host and invitees; anyone else gets
  `404`, the same answer as for a meeting that does not exist. Only the host can edit, cancel or invite
  (an invitee gets `403`). Invitees can view the meeting and remove themselves. Invitee emails are shown only to the host.
- **Times:** ISO 8601, stored and returned in UTC. A start time cannot be in the past (one minute of
  tolerance) or more than a year ahead. Duration: 5 to 480 minutes. Call type: `audio` or `video`.
- **Editing:** only while the meeting is scheduled and before it starts. Cancelling keeps the meeting
  (status `cancelled`, listed under `past`) and is allowed until the meeting is over.
- **Invitations:** by the exact email of a registered user, up to 50 invitees per meeting, 30 invitation
  requests per hour per user.
- **Joining:** the rule is `assertCanJoin`: from 15 minutes before the start until the end, for the host and
  invitees of a scheduled meeting. The signaling server applies it when issuing a ticket and again when a
  participant joins (see [Calls](#calls-signaling-server)).

## Calls (signaling server)

Audio and video travel directly between the participants' browsers (WebRTC) and never through the server.
The server's part is **signaling**: deciding who may join, telling participants who is in the call, and
relaying the small messages browsers need to connect to each other. The full protocol is in
[`packages/signaling-protocol/README.md`](packages/signaling-protocol/README.md); the two HTTP endpoints it
uses are in [`apps/api/openapi.yaml`](apps/api/openapi.yaml).

- **Joining:** a browser asks `POST /api/v1/ws-tickets` for a single-use ticket (valid 30 seconds), then opens
  `/api/v1/ws?ticket=...`. Only the host and invitees of a scheduled meeting can get a ticket, from 15 minutes
  before the start until the end. Access is checked again when the participant sends `join`.
- **Rooms:** at most 10 people in an audio meeting and 4 in a video meeting (`MAX_PARTICIPANTS_AUDIO`,
  `MAX_PARTICIPANTS_VIDEO`). Each person has one place per meeting: joining again, from another tab or after a
  dropped connection, replaces the older connection.
- **Isolation:** messages are delivered only inside one room, and the sender is always set by the server; a
  client that names a sender or sends anything outside the protocol is disconnected.
- **Changes through the REST API apply to live calls:** cancelling a meeting ends its call, and removing an
  invitee (or an invitee leaving) disconnects them.
- **Protection:** messages are limited to 64 KiB, each connection has a message rate limit, silent
  connections are dropped, and a connection must join within 10 seconds. Tickets and call content are never logged.
- **ICE servers:** `GET /api/v1/ice-servers` returns STUN servers (`STUN_URLS`) and, when `TURN_URLS` and
  `TURN_SHARED_SECRET` are set, TURN credentials made for the user that expire after one hour. TURN is for
  people behind restrictive networks and is optional.
- **Limits of this version:** rooms live in the memory of one API process, so a restart ends all calls
  (people are told the service is restarting and can rejoin from the screen). A running call is not cut off at the meeting's end time; nobody new
  can join after it. There is no "end the meeting for everyone" yet (cancelling ends the call).
- **In development** the WebSocket goes through the same Vite proxy as REST. In production the browser must
  connect directly to the API host, because Netlify cannot proxy WebSockets: set `VITE_SIGNALING_URL` when
  building the web app (see [The call screen](#the-call-screen)).

## The call screen

`/meetings/:id/call`, reached from the meeting details. The page has three states:

1. **Lobby.** Choose "Join with camera and microphone" or "Join with microphone only" (an audio meeting
   offers only the microphone). The browser asks for permission only after the choice. If joining is not open,
   or the meeting is cancelled or over, the page says so.
2. **In the call.** One tile per participant (name, and "Microphone off" / "Camera off" / connection problems
   written out, not only drawn), a list that announces arrivals and departures politely, and the controls:
   microphone, camera and leave. Your own tile is muted and mirrored.
3. **Ended.** The reason is shown and read out (you left, you joined from another tab, the host removed you or
   cancelled the meeting, the call is full, the service is restarting, the connection was lost), with a
   **Rejoin** button when joining again can work.

How it works, briefly:

- Each participant keeps one WebRTC connection to every other participant (a _mesh_). The person who joins
  sends an offer to each person already in the call and the others only answer, so two offers never cross.
  Muting and turning the camera off switch the tracks off and tell the others; nothing is renegotiated.
- Because every participant uploads a separate video to each of the others, the video bitrate per connection
  is capped by room size: 800 kbps for one other person, 400 kbps in a full four-person room (down to a
  150 kbps floor).
- Leaving the screen, by any route, ends the call and releases the camera and microphone.
- The call logic (`apps/web/src/calls/callSession.ts`) does not touch the browser directly: the camera, WebRTC
  and WebSocket are passed in, which is how it is tested without a browser.
- **Configuration:** `VITE_SIGNALING_URL` (for example `wss://api.example.com/api/v1/ws`), read when the web app
  is built, is the WebSocket address of the API in production. Without it the address is derived from the page,
  which is what the development proxy needs. See `apps/web/.env.example`.
- **Limits of this version:** a dropped connection ends the call and the person rejoins by hand; there is no
  device picker, screen sharing or chat; the mesh is meant for the room sizes above, not for more.

## Testing and quality checks

```bash
npm test             # all workspaces; the API tests need the MySQL container running
npm run lint
npm run typecheck
npm run format:check # npm run format to fix
npm run build
```

API tests run against a separate database (`DB_TEST_NAME`, default `meet_sync_test`): the test run
applies the migrations to it and deletes its rows between tests, and refuses to run against a database
whose name does not end in `_test`. The same checks run in CI (`.github/workflows/ci.yml`), plus `npm audit`.

The shared protocol package is compiled, and `npm test`, `npm run typecheck`, `npm run dev:api` and
`npm run dev:web` build it first. If you run a single workspace's scripts directly, run
`npm run build:protocol` once beforehand.

## Project structure

```text
apps/api   Express API and the WebSocket signaling server
           src/config        environment parsing and validation
           src/db            connection pool, transactions, migration runner, SQL migrations
           src/repositories  SQL access (parameterized queries only)
           src/services      business rules (authentication, password hashing, tokens, meetings)
           src/http          routes, middleware (validation, rate limits, auth), error handling
           src/signaling     WebSocket gateway, rooms, tickets, ICE servers (STUN/TURN credentials)
           src/seed          development-only test accounts and meetings (`npm run seed`)
           openapi.yaml      API description
apps/web   React single-page app
           src/api     API client (typed errors, session refresh)
           src/auth    session state, route guards, login/register form logic
           src/i18n    English and Spanish texts, language detection
           src/meetings  meeting forms, dates and time zones, validation, data loading
           src/calls   the call: camera and WebRTC logic, signaling connection, tiles and controls
           src/forms   shared form logic (validation, field problems, submission)
           src/pages   screens; src/components shared UI pieces
packages/signaling-protocol   WebSocket message schemas and types shared by the API and the web app
docker/    local MySQL account setup script
```

## Database migrations

Migrations are numbered SQL files in `apps/api/src/db/migrations/` applied in order by
`npm run migrate -w @meet-sync/api` (in a built deployment: `npm run migrate:prod -w @meet-sync/api` after `npm run build`).
Applied files are recorded with a checksum in `schema_migrations`; editing an applied migration is rejected, so
add a new numbered file instead. MySQL commits schema changes immediately, so a migration that fails part-way
is not rolled back and must be fixed by hand.

## Security

Do not commit secrets. `.env` files are git-ignored; only `.env.example` files with placeholder
values are committed.

The one deliberate exception is the password of the development test accounts (see
[Trying the app with test users](#trying-the-app-with-test-users)). It protects nothing: the accounts exist
only in a developer's own local database, the seed command refuses to run against any other, and it is left
out of the production build.
