const MAX_PEERS = 64;
const ROOM_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    if (request.headers.get('Origin') !== url.origin) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const room = url.searchParams.get('room');
    if (room !== null && !ROOM_PATTERN.test(room)) {
      return new Response('Invalid room link', { status: 400 });
    }
    // Cloudflare supplies this header in production. Never use a client-supplied
    // query parameter or X-Forwarded-For to choose the automatic discovery group.
    const ip = request.headers.get('CF-Connecting-IP');
    if (!room && !ip && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return new Response('Network discovery unavailable; use a private room link.', { status: 400 });
    }
    const name = room ? `room:${room}` : `network:${ip || 'local-development'}`;
    return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(request);
  },
};

export class StreamRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  fetch() {
    if (this.sockets().length >= MAX_PEERS) return new Response('Room is full', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID();
    server.serializeAttachment({ id, name: 'PC', live: false, watching: null, window: 0, count: 0 });
    this.ctx.acceptWebSocket(server);
    this.send(server, { type: 'welcome', id });
    this.publish();
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() {
    return this.ctx.getWebSockets().filter(socket => socket.readyState === 1);
  }

  send(socket, message) {
    try { socket.send(JSON.stringify(message)); } catch { /* Close callback removes the peer. */ }
  }

  publish() {
    const sockets = this.sockets();
    const peers = sockets.map(socket => {
      const { id, name, live } = socket.deserializeAttachment();
      return { id, name, live };
    });
    for (const socket of sockets) this.send(socket, { type: 'peers', peers });
  }

  stopWatching(socket, state) {
    if (!state.watching) return;
    const broadcaster = this.sockets().find(peer => peer.deserializeAttachment().id === state.watching);
    if (broadcaster) this.send(broadcaster, { type: 'peer-left', id: state.id });
    state.watching = null;
    socket.serializeAttachment(state);
  }

  stopViewers(id) {
    for (const socket of this.sockets()) {
      const state = socket.deserializeAttachment();
      if (state.watching !== id) continue;
      state.watching = null;
      socket.serializeAttachment(state);
      this.send(socket, { type: 'peer-left', id });
    }
  }

  webSocketMessage(socket, raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 32768) {
      socket.close(1009, 'Message too large');
      return;
    }
    const state = socket.deserializeAttachment();
    const now = Date.now();
    if (now - state.window > 10000) { state.window = now; state.count = 0; }
    state.count += 1;
    socket.serializeAttachment(state);
    if (state.count > 200) { socket.close(1008, 'Too many messages'); return; }
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      state.name = typeof message.name === 'string' ? message.name.trim().slice(0, 48) || 'PC' : 'PC';
      socket.serializeAttachment(state);
      this.publish();
    } else if (message.type === 'broadcast' && typeof message.live === 'boolean') {
      this.stopWatching(socket, state);
      state.live = message.live;
      socket.serializeAttachment(state);
      if (!state.live) this.stopViewers(state.id);
      this.publish();
    } else if (message.type === 'unwatch') {
      this.stopWatching(socket, state);
    } else if (message.type === 'watch' && !state.live) {
      const target = this.sockets().find(peer => peer.deserializeAttachment().id === message.to);
      if (!target || target === socket || !target.deserializeAttachment().live) {
        this.send(socket, { type: 'error', message: 'That camera is no longer live.' });
        return;
      }
      this.stopWatching(socket, state);
      state.watching = message.to;
      socket.serializeAttachment(state);
      this.send(target, { type: 'watcher', id: state.id });
    } else if (['offer', 'answer', 'candidate'].includes(message.type)) {
      const target = this.sockets().find(peer => peer.deserializeAttachment().id === message.to);
      if (!target) return;
      const other = target.deserializeAttachment();
      const sending = state.live && other.watching === state.id;
      const watching = other.live && state.watching === other.id;
      if ((message.type === 'offer' && !sending) || (message.type === 'answer' && !watching)) return;
      if (!sending && !watching) return;
      this.send(target, { type: message.type, id: state.id, data: message.data });
    }
  }

  webSocketClose(socket, code) {
    const state = socket.deserializeAttachment();
    try { socket.close(code === 1006 ? 1011 : code, 'Disconnected'); } catch { /* Already closed. */ }
    this.stopWatching(socket, state);
    this.stopViewers(state.id);
    this.publish();
  }

  webSocketError(socket) {
    this.webSocketClose(socket, 1011);
  }
}
