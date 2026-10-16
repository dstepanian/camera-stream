import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { StreamRoom } from '../worker.js';

function setup() {
  const sockets = [];
  const ctx = { getWebSockets: () => sockets };
  const room = new StreamRoom(ctx);
  function peer(id, live = false) {
    const socket = {
      readyState: 1, messages: [],
      state: { id, name: id, live, watching: null, window: 0, count: 0 },
      deserializeAttachment() { return structuredClone(this.state); },
      serializeAttachment(value) { this.state = structuredClone(value); },
      send(value) { this.messages.push(JSON.parse(value)); },
      close() { this.readyState = 3; },
    };
    sockets.push(socket);
    return socket;
  }
  const send = (socket, value) => room.webSocketMessage(socket, JSON.stringify(value));
  return { room, ctx, peer, send };
}

test('discovery publishes named online and live peers and survives hibernation', () => {
  const { room, ctx, peer, send } = setup();
  const a = peer('a');
  const b = peer('b');
  send(a, { type: 'hello', name: 'Office PC' });
  send(a, { type: 'broadcast', live: true });
  const resumed = new StreamRoom(ctx);
  resumed.publish();
  assert.deepEqual(b.messages.at(-1).peers, [
    { id: 'a', name: 'Office PC', live: true }, { id: 'b', name: 'b', live: false },
  ]);
  room.webSocketClose(a, 1000);
  assert.deepEqual(b.messages.at(-1).peers.map(p => p.id), ['b']);
});

test('offers, answers and ICE go only between a selected camera and its viewer', () => {
  const { peer, send } = setup();
  const a = peer('a', true);
  const b = peer('b');
  const outsider = peer('outsider');
  send(a, { type: 'offer', to: 'b', data: 'before watching' });
  assert.equal(b.messages.length, 0);
  send(b, { type: 'watch', to: 'a' });
  assert.deepEqual(a.messages.at(-1), { type: 'watcher', id: 'b' });
  send(a, { type: 'offer', to: 'b', data: { sdp: 'offer' } });
  assert.equal(b.messages.at(-1).data.sdp, 'offer');
  send(b, { type: 'answer', to: 'a', data: { sdp: 'answer' } });
  assert.equal(a.messages.at(-1).data.sdp, 'answer');
  send(b, { type: 'candidate', to: 'a', data: { candidate: 'ice' } });
  assert.equal(a.messages.at(-1).data.candidate, 'ice');
  send(outsider, { type: 'candidate', to: 'a', data: 'invalid' });
  assert.equal(a.messages.at(-1).data.candidate, 'ice');
  send(a, { type: 'answer', to: 'b', data: 'wrong direction' });
  assert.equal(b.messages.at(-1).type, 'offer');
});

test('switching, stopping and disconnecting clean up subscriptions', () => {
  const { room, peer, send } = setup();
  const a = peer('a', true);
  const b = peer('b');
  const c = peer('c', true);
  send(b, { type: 'watch', to: 'a' });
  send(b, { type: 'watch', to: 'c' });
  assert.deepEqual(a.messages.at(-1), { type: 'peer-left', id: 'b' });
  send(c, { type: 'broadcast', live: false });
  assert.equal(b.state.watching, null);
  assert.ok(b.messages.some(m => m.type === 'peer-left' && m.id === 'c'));
  send(b, { type: 'watch', to: 'a' });
  room.webSocketClose(b, 1000);
  assert.ok(a.messages.some(m => m.type === 'peer-left' && m.id === 'b'));
});

test('invalid, oversized and flooding messages are handled', () => {
  const { room, peer, send } = setup();
  const a = peer('a');
  room.webSocketMessage(a, 'invalid json');
  room.webSocketMessage(a, 'null');
  send(a, { type: 'watch', to: 'missing' });
  assert.equal(a.messages.at(-1).type, 'error');
  room.webSocketMessage(a, 'x'.repeat(32769));
  assert.equal(a.readyState, 3);
  const flood = peer('flood');
  for (let i = 0; i < 201; i++) send(flood, { type: 'unknown' });
  assert.equal(flood.readyState, 3);
});

test('worker isolates networks and private rooms and rejects cross-origin upgrades', async () => {
  const groups = [];
  const env = {
    ASSETS: { fetch: async () => new Response('asset') },
    ROOMS: { idFromName: name => name, get: name => ({ fetch: async () => {
      groups.push(name); return new Response('room');
    } }) },
  };
  function request(ip, query = '', origin = 'https://stream.zromek.de') {
    return new Request(`https://stream.zromek.de/ws${query}`, {
      headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': ip },
    });
  }
  await worker.fetch(request('192.0.2.1'), env);
  await worker.fetch(request('192.0.2.2'), env);
  assert.notEqual(groups[0], groups[1]);
  await worker.fetch(request('192.0.2.1', '?room=private-room-123456'), env);
  await worker.fetch(request('192.0.2.2', '?room=private-room-123456'), env);
  assert.equal(groups[2], groups[3]);
  assert.equal((await worker.fetch(request('192.0.2.1', '', 'https://other.example'), env)).status, 403);
  assert.equal((await worker.fetch(request('192.0.2.1', '?room=short'), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://stream.zromek.de/ws'), env)).status, 426);
  assert.equal(await (await worker.fetch(new Request('https://stream.zromek.de/'), env)).text(), 'asset');
});
