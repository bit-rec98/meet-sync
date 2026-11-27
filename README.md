# MeetSync

A meeting suite for work teams: schedule, manage, and hold audio and video meetings in the browser.
It is also a learning project for **WebSockets** and **WebRTC**.

## Status

**Early development.** The project was restarted from scratch after the previous implementation
was lost. Features listed under "Planned features" are **not implemented yet**.

## Planned features

- Accounts (register, log in, log out).
- Schedule, edit, cancel, and list meetings; invite registered users (invited users only, no guests).
- Join a meeting as an audio call or a video call, with mute and camera controls.
- Real-time presence and WebRTC signaling over WebSockets.
- Room size: up to 10 participants for audio calls and 4 for video calls (configurable).

Out of scope for the first version: text chat, screen sharing, recording, guest access, video calls
above the video participant limit.

## Technology stack

| Area             | Technology                                                                                   | In the code today  |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| Frontend         | React, Vite, TypeScript                                                                      | Yes (placeholder)  |
| Backend          | Node.js, Express, TypeScript                                                                 | Yes (health route) |
| WebSockets       | `ws`                                                                                         | Not yet            |
| Database         | MySQL (local via Docker)                                                                     | Container only     |
| Real-time media  | WebRTC (peer-to-peer mesh)                                                                   | Not yet            |
| Frontend hosting | Netlify (the backend runs on a separate host that supports long-lived WebSocket connections) | Not yet            |

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
cp .env.example .env     # then replace every placeholder password in .env
docker compose up -d --wait   # starts MySQL on 127.0.0.1:3307
```

Configuration is documented in [`.env.example`](.env.example). The API currently reads only
`NODE_ENV` and `API_PORT`; the MySQL variables are used by `docker-compose.yml` and will be
read by the API when database access is implemented.

## Running

```bash
npm run dev:api   # API on http://localhost:3000, health check at /api/v1/health
npm run dev:web   # web app on http://localhost:5173, proxies /api to the API
```

## Testing and quality checks

```bash
npm test             # unit and integration tests in all workspaces
npm run lint
npm run typecheck
npm run format:check # npm run format to fix
npm run build
```

The same checks run in CI (`.github/workflows/ci.yml`), plus `npm audit`.

## Project structure

```text
apps/api   Express API (and, later, the WebSocket signaling server)
apps/web   React single-page app
```

Planned: a shared `packages/signaling-protocol` workspace for WebSocket message schemas, and
SQL migrations in the API, added when those features are implemented.

## Security

Do not commit secrets. `.env` files are git-ignored; only `.env.example` files with placeholder
values are committed.
