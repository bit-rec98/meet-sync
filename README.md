# MeetSync

A meeting suite for work teams: schedule, manage, and hold audio and video meetings in the browser.
It is also a learning project for **WebSockets** and **WebRTC**.

## Status

**Early development.** The project was restarted from scratch after the previous implementation
was lost.

**Implemented:** accounts through the REST API (register, log in, refresh, log out, current user)
with rate limiting; there is no user interface for them yet.
**Not implemented yet:** everything else under "Planned features".

## Features

- Implemented: accounts (register, log in, log out, session refresh). See [Authentication](#authentication).

## Planned features

- Schedule, edit, cancel, and list meetings; invite registered users (invited users only, no guests).
- Join a meeting as an audio call or a video call, with mute and camera controls.
- Real-time presence and WebRTC signaling over WebSockets.
- Room size: up to 10 participants for audio calls and 4 for video calls (configurable).

Out of scope for the first version: text chat, screen sharing, recording, guest access, video calls
above the video participant limit.

## Technology stack

| Area             | Technology                                                                                   | In the code today     |
| ---------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| Frontend         | React, Vite, TypeScript                                                                      | Yes (placeholder)     |
| Backend          | Node.js, Express, TypeScript                                                                 | Yes (health, auth)    |
| WebSockets       | `ws`                                                                                         | Not yet               |
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

## Project structure

```text
apps/api   Express API (and, later, the WebSocket signaling server)
           src/config        environment parsing and validation
           src/db            connection pool, transactions, migration runner, SQL migrations
           src/repositories  SQL access (parameterized queries only)
           src/services      business rules (authentication, password hashing, tokens)
           src/http          routes, middleware (validation, rate limits, auth), error handling
           openapi.yaml      API description
apps/web   React single-page app
docker/    local MySQL account setup script
```

Planned: a shared `packages/signaling-protocol` workspace for WebSocket message schemas, added with the signaling server.

## Database migrations

Migrations are numbered SQL files in `apps/api/src/db/migrations/` applied in order by
`npm run migrate -w @meet-sync/api` (in a built deployment: `npm run migrate:prod -w @meet-sync/api` after `npm run build`).
Applied files are recorded with a checksum in `schema_migrations`; editing an applied migration is rejected, so
add a new numbered file instead. MySQL commits schema changes immediately, so a migration that fails part-way
is not rolled back and must be fixed by hand.

## Security

Do not commit secrets. `.env` files are git-ignored; only `.env.example` files with placeholder
values are committed.
