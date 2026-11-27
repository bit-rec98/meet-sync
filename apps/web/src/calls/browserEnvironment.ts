import { buildSignalingUrl, openSignalingChannel, type WebSocketLike } from './signalingChannel';
import type { CallEnvironment, PeerConnectionLike, StreamLike } from './types';

function configuredSignalingUrl(): string | undefined {
  const value: unknown = import.meta.env['VITE_SIGNALING_URL'];
  return typeof value === 'string' ? value : undefined;
}

/** The browser's WebSocket, with handlers that take only what the call logic reads. */
function adaptWebSocket(address: string): WebSocketLike {
  const socket = new WebSocket(address);
  const adapted: WebSocketLike = {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code) => socket.close(code),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = () => adapted.onopen?.();
  socket.onmessage = (event: MessageEvent<unknown>) => adapted.onmessage?.({ data: event.data });
  socket.onclose = (event) => adapted.onclose?.({ code: event.code });
  socket.onerror = () => adapted.onerror?.();
  return adapted;
}

/** The browser's RTCPeerConnection, with handlers that take only what the call logic reads. */
function adaptPeerConnection(configuration: RTCConfiguration): PeerConnectionLike {
  const connection = new RTCPeerConnection(configuration);
  const adapted: PeerConnectionLike = {
    addTrack: (track, stream) =>
      connection.addTrack(track as MediaStreamTrack, stream as MediaStream),
    createOffer: () => connection.createOffer(),
    createAnswer: () => connection.createAnswer(),
    setLocalDescription: (description) => connection.setLocalDescription(description),
    setRemoteDescription: (description) => connection.setRemoteDescription(description),
    addIceCandidate: (candidate) => connection.addIceCandidate(candidate),
    getSenders: () =>
      connection.getSenders().map((sender) => ({
        get track() {
          return sender.track;
        },
        getParameters: () => sender.getParameters(),
        // Always the object `getParameters` returned, with a changed encoding.
        setParameters: (parameters) => sender.setParameters(parameters as RTCRtpSendParameters),
      })),
    close: () => connection.close(),
    get connectionState() {
      return connection.connectionState;
    },
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
  };
  connection.onicecandidate = (event) => adapted.onicecandidate?.({ candidate: event.candidate });
  connection.ontrack = (event) => adapted.ontrack?.({ track: event.track, streams: event.streams });
  connection.onconnectionstatechange = () => adapted.onconnectionstatechange?.();
  return adapted;
}

/**
 * The real camera, microphone, WebRTC and WebSocket of the browser the app runs in. This is the only
 * place that touches them; everything else receives it as a {@link CallEnvironment}.
 */
export function createBrowserEnvironment(): CallEnvironment {
  return {
    async getUserMedia(constraints) {
      if (!navigator.mediaDevices?.getUserMedia) {
        // Browsers only offer the camera on secure pages (https or localhost).
        throw Object.assign(new Error('Media devices are not available'), {
          name: 'NotFoundError',
        });
      }
      const stream: StreamLike = await navigator.mediaDevices.getUserMedia(
        constraints as MediaStreamConstraints,
      );
      return stream;
    },

    createPeerConnection: adaptPeerConnection,

    openSignaling(ticket) {
      const url = buildSignalingUrl({
        ticket,
        override: configuredSignalingUrl(),
        page: { protocol: window.location.protocol, host: window.location.host },
      });
      return openSignalingChannel(url, adaptWebSocket);
    },
  };
}
