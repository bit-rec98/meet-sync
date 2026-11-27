# @meet-sync/signaling-protocol

The messages exchanged between the web app and the signaling server, as [Zod](https://zod.dev) schemas
and TypeScript types, shared so both sides cannot drift apart. This file is the reference for the
WebSocket protocol; the REST endpoints are described in `apps/api/openapi.yaml`.

The package is compiled (`npm run build -w @meet-sync/signaling-protocol`). The root scripts that need it
(`test`, `typecheck`, `dev:api`, `dev:web`) build it first.

## What signaling is for

Audio and video travel directly between browsers (WebRTC) and never through the server. Before two
browsers can connect they must exchange small control messages: who is in the call, and the session
descriptions and network candidates needed to set up each connection. The server relays those messages
and decides who may take part; it never sees media.

## Joining a call

1. `POST /api/v1/ws-tickets` with `{ "meetingId": "<uuid>" }` and the access token. The server applies the
   join rule (host or invitee of a scheduled meeting, from 15 minutes before the start until the end) and
   answers `201 { "ticket": "...", "expiresInSeconds": 30 }`. A ticket works once.
2. `GET /api/v1/ice-servers` returns the `iceServers` for `RTCPeerConnection` (STUN, and TURN with
   credentials valid for one hour when a TURN server is configured).
3. Open `wss://<api host>/api/v1/ws?ticket=<ticket>`. Browsers cannot send an `Authorization` header on a
   WebSocket, which is why the short-lived ticket exists. The `Origin` must be one of the web app's origins.
4. Send `join`. The server checks access again (30 seconds may have passed) and answers `joined`.
5. The participant who just joined creates an offer for each person already in the room (the
   `peers` of `joined`) and sends it with `offer`. Existing participants only answer, so two offers never collide.

## Messages

All messages are JSON text. Every object is strict: an unknown field makes a message invalid.

### Client to server

| `type`          | Fields                                       | Meaning                                                       |
| --------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `join`          | `media`: `"audio"` or `"video"`              | Enter the room. An audio meeting cannot be joined with video. |
| `leave`         |                                              | Leave and close the connection.                               |
| `offer`         | `to` (peer id), `sdp`                        | Relayed to the peer `to`.                                     |
| `answer`        | `to`, `sdp`                                  | Relayed to the peer `to`.                                     |
| `ice-candidate` | `to`, `candidate` (an `RTCIceCandidateInit`) | Relayed to the peer `to`.                                     |
| `media-state`   | `audioEnabled`, `videoEnabled`               | Mute and camera state, shown to the other participants.       |

### Server to client

| `type`             | Fields                                   | Meaning                                                        |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `joined`           | `selfId`, `peers`                        | Answer to `join`: your peer id and who is already in the room. |
| `peer-joined`      | `peer`                                   | Someone joined. They will send you an offer.                   |
| `peer-left`        | `peerId`                                 | Someone left or lost their connection.                         |
| `peer-media-state` | `peerId`, `audioEnabled`, `videoEnabled` | Someone muted or turned their camera on or off.                |
| `offer`, `answer`  | `from`, `sdp`                            | Relayed from another participant.                              |
| `ice-candidate`    | `from`, `candidate`                      | Relayed from another participant.                              |
| `bye`              | `reason`                                 | The server is about to close the connection (see below).       |
| `error`            | `code`                                   | A message was refused (see below).                             |

A **peer** is a connection, identified by an id the server generates (`selfId`). A peer has `id`,
`displayName`, `media`, `audioEnabled` and `videoEnabled`. User ids and email addresses are never sent.

The sender of a relayed message (`from`) is always set by the server. A client that sends a `from` field,
or anything else the schema does not allow, is disconnected.

### Errors

| `code`            | Meaning                                                                     | Connection    |
| ----------------- | --------------------------------------------------------------------------- | ------------- |
| `invalid_message` | Not valid JSON, not a text message, or does not match the schema.           | closed (1008) |
| `rate_limited`    | Too many messages.                                                          | closed (1008) |
| `not_joined`      | A message other than `join` before joining.                                 | stays open    |
| `already_joined`  | A second `join`.                                                            | stays open    |
| `invalid_media`   | `join` with video in an audio meeting. Join again with audio.               | stays open    |
| `unknown_peer`    | `to` is not in your room (or is yourself).                                  | stays open    |
| `room_full`       | The room is at its limit (default 10 for audio, 4 for video).               | closed (4005) |
| `not_allowed`     | You may not join now: the meeting is over or cancelled, or you lost access. | closed (4004) |
| `server_error`    | Something failed on the server.                                             | closed (1011) |

### Why the server ends a connection (`bye`)

`replaced` (the same user joined again from another tab or after reconnecting; a user has one place per
meeting), `removed` (the host removed you, or you left the meeting through the API), `meeting_cancelled`,
`server_shutdown`.

### Close codes

`1000` normal, `1001` server shutting down, `1008` policy violation, `1009` message too big (limit 64 KiB),
`1011` server error, and for this application `4001` replaced, `4002` removed, `4003` meeting cancelled,
`4004` not allowed, `4005` room full. They are exported as `CLOSE_CODES`.

## Limits and behavior

- Messages larger than 64 KiB close the connection. Compression is off.
- Each connection may send a burst of about 400 messages and then about 200 per second. Setting up
  connections to nine peers sends dozens of candidates at once, which fits within that.
- A connection must send `join` within 10 seconds, and must answer the server's pings (every 30 seconds).
- Reconnecting is a new ticket and a new `join`; the older connection of the same user is replaced.
- Joining is refused after the meeting's end time, but people already in the call are not cut off.

## Using it

```ts
import {
  parseServerMessage,
  SIGNALING_PATH,
  type ClientMessage,
} from '@meet-sync/signaling-protocol';

socket.send(JSON.stringify({ type: 'join', media: 'video' } satisfies ClientMessage));
socket.onmessage = (event) => {
  const message = parseServerMessage(String(event.data)); // null if it does not follow the protocol
  if (message?.type === 'joined') {
    /* message.selfId, message.peers */
  }
};
```
