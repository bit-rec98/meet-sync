import { createHmac } from 'node:crypto';
import type { IceServer } from '@meet-sync/signaling-protocol';
import type { SignalingConfig } from '../config/env.js';

const TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

/**
 * Time-limited TURN credentials, in the format TURN servers such as coturn accept with a shared
 * secret ("TURN REST API"): the username is the expiry time and the user, and the password is an
 * HMAC of it. The server checks the HMAC and the expiry; no password is ever stored or reused.
 * (HMAC-SHA1 is what that scheme specifies; it is used as a keyed hash here, not for collision resistance.)
 */
export function turnCredentials(
  sharedSecret: string,
  userId: string,
  now: Date,
  ttlSeconds = TURN_CREDENTIAL_TTL_SECONDS,
): { username: string; credential: string } {
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
  return { username, credential };
}

/** The `iceServers` a browser needs for its RTCPeerConnection: STUN, and TURN when configured. */
export function buildIceServers(config: SignalingConfig, userId: string, now: Date): IceServer[] {
  const servers: IceServer[] = [];
  if (config.stunUrls.length > 0) servers.push({ urls: [...config.stunUrls] });
  if (config.turn) {
    servers.push({
      urls: [...config.turn.urls],
      ...turnCredentials(config.turn.sharedSecret, userId, now),
    });
  }
  return servers;
}
