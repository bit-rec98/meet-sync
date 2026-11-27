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

| Area | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Backend | Node.js, Express, `ws` (WebSockets), TypeScript |
| Database | MySQL |
| Real-time media | WebRTC (peer-to-peer mesh) |
| Frontend hosting | Netlify (the backend runs on a separate host that supports long-lived WebSocket connections) |

## Architecture overview

- **Media** (audio/video) travels directly between browsers over WebRTC, encrypted with DTLS-SRTP.
  It does not pass through the application server (a TURN relay is used only when a direct
  connection is impossible).
- **WebSockets** carry *signaling*: presence (who joined or left) and the messages peers
  exchange to set up WebRTC connections.
- **REST over HTTPS** handles accounts, authentication, and meeting management.
- **MySQL** stores users, meetings, and invitations. It stores no call content.
- The API and the signaling server run as one Node process; the React app is a static site.

## Prerequisites, setup, running, and testing

Added together with the project scaffolding; see the repository history for the current state.

## Security

Do not commit secrets. `.env` files are git-ignored; only `.env.example` files with placeholder
values are committed.
