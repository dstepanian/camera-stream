import './style.css';

const app = document.getElementById('app');
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } },
};
const room = new URL(location.href).searchParams.get('room');
let socket, ownId, localStream, watching, reconnectTimer;
let peers = [];
let cameraPending = false;
const connections = new Map();
const iceConfig = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };

app.innerHTML = `
  <main class="dashboard">
    <header><h1>StreamLine</h1><p>Camera streaming between your PCs</p></header>
    <section class="panel">
      <label for="device-name">This device</label>
      <input id="device-name" maxlength="48" autocomplete="off" placeholder="e.g. Office PC">
      <p id="connection-status" class="status" role="status">Connecting…</p>
      <p class="hint" id="discovery-note"></p>
      <div class="actions">
        <button id="broadcast-btn" disabled>Broadcast Camera</button>
        <button id="room-btn" class="secondary">Create private room</button>
        <button id="copy-btn" class="secondary">Copy room link</button>
        <button id="network-btn" class="secondary" hidden>Find PCs on this network</button>
      </div>
      <p id="action-status" class="status" role="status"></p>
    </section>
    <section class="panel"><h2>Other devices</h2><ul id="peers"></ul></section>
    <section id="video-panel" class="panel" hidden>
      <div class="video-heading"><h2 id="video-title">Camera</h2>
        <button id="stop-watch-btn" class="secondary" hidden>Stop watching</button>
        <button id="fullscreen-btn" class="secondary">Fullscreen</button>
      </div>
      <video id="video" autoplay playsinline controls></video>
      <p id="video-status" class="status" role="status"></p>
    </section>
  </main>`;
const $ = id => document.getElementById(id);
const nameInput = $('device-name');
const video = $('video');
nameInput.value = storage.get('streamline-device-name') || `PC ${crypto.randomUUID().slice(0, 4)}`;
$('discovery-note').textContent = room
  ? 'Private room: only devices using this room link appear here. Anyone with the link can watch a live camera.'
  : 'PCs with this app open on the same public internet address appear automatically. Anyone in this group can watch a live camera. Use a private room link for a smaller group or if a PC is missing.';
$('copy-btn').hidden = !room;
$('network-btn').hidden = !room;

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}
function closePeer(id) {
  const connection = connections.get(id);
  connections.delete(id);
  connection?.pc.close();
}
function stopWatching() {
  if (watching) closePeer(watching);
  watching = null;
  send({ type: 'unwatch' });
  $('stop-watch-btn').hidden = true;
  if (!localStream) { video.srcObject = null; $('video-panel').hidden = true; }
  renderPeers();
}
function renderPeers() {
  const list = $('peers');
  list.replaceChildren();
  const others = peers.filter(peer => peer.id !== ownId);
  if (!others.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No other devices yet. Open this app on another PC, or share a private room link.';
    list.append(empty);
  }
  for (const peer of others) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${peer.name} · ${peer.live ? 'Camera live' : 'Online'}`;
    row.append(label);
    if (peer.live) {
      const button = document.createElement('button');
      button.textContent = watching === peer.id ? 'Watching' : 'Watch';
      button.disabled = Boolean(localStream || cameraPending || watching === peer.id);
      button.addEventListener('click', () => watch(peer));
      row.append(button);
    }
    list.append(row);
  }
}
function watch(peer) {
  stopWatching();
  watching = peer.id;
  $('video-panel').hidden = false;
  $('stop-watch-btn').hidden = false;
  $('video-title').textContent = peer.name;
  $('video-status').textContent = 'Connecting to camera…';
  video.muted = false;
  send({ type: 'watch', to: peer.id });
  renderPeers();
}
function createPeer(id) {
  closePeer(id);
  const pc = new RTCPeerConnection(iceConfig);
  const connection = { pc, pending: [] };
  connections.set(id, connection);
  pc.onicecandidate = event => {
    if (event.candidate) send({ type: 'candidate', to: id, data: event.candidate });
  };
  pc.ontrack = event => {
    if (watching !== id) return;
    video.srcObject = event.streams[0];
    video.play().catch(() => { $('video-status').textContent = 'Press Play to start the video.'; });
  };
  pc.onconnectionstatechange = () => {
    if (watching !== id) return;
    const state = pc.connectionState;
    $('video-status').textContent = state === 'connected' ? 'Live · direct connection'
      : state === 'failed' ? 'Connection failed. Check the firewall or use the same Wi-Fi. Some networks need a TURN relay.'
      : `Connection: ${state}`;
  };
  return connection;
}
async function remoteDescription(connection, data) {
  await connection.pc.setRemoteDescription(data);
  for (const candidate of connection.pending.splice(0)) await connection.pc.addIceCandidate(candidate);
}
async function onMessage(message) {
  if (message.type === 'welcome') {
    ownId = message.id;
    send({ type: 'hello', name: nameInput.value });
    if (localStream) send({ type: 'broadcast', live: true });
  } else if (message.type === 'peers') {
    peers = message.peers;
    for (const id of connections.keys()) if (!peers.some(peer => peer.id === id)) closePeer(id);
    if (watching && !peers.some(peer => peer.id === watching && peer.live)) {
      stopWatching();
      $('action-status').textContent = 'That camera went offline.';
    }
    renderPeers();
  } else if (message.type === 'watcher' && localStream) {
    const connection = createPeer(message.id);
    localStream.getTracks().forEach(track => connection.pc.addTrack(track, localStream));
    await connection.pc.setLocalDescription(await connection.pc.createOffer());
    send({ type: 'offer', to: message.id, data: connection.pc.localDescription });
  } else if (message.type === 'offer' && message.id === watching) {
    const connection = createPeer(message.id);
    await remoteDescription(connection, message.data);
    await connection.pc.setLocalDescription(await connection.pc.createAnswer());
    send({ type: 'answer', to: message.id, data: connection.pc.localDescription });
  } else if (message.type === 'answer') {
    const connection = connections.get(message.id);
    if (connection) await remoteDescription(connection, message.data);
  } else if (message.type === 'candidate') {
    const connection = connections.get(message.id);
    if (!connection) return;
    if (connection.pc.remoteDescription) await connection.pc.addIceCandidate(message.data);
    else connection.pending.push(message.data);
  } else if (message.type === 'peer-left') {
    closePeer(message.id);
    if (watching === message.id) {
      stopWatching();
      $('action-status').textContent = 'Broadcast ended.';
    }
  } else if (message.type === 'error') {
    stopWatching();
    $('action-status').textContent = message.message;
  }
}
function connect() {
  clearTimeout(reconnectTimer);
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (room) url.searchParams.set('room', room);
  const current = new WebSocket(url);
  socket = current;
  current.onopen = () => {
    $('connection-status').textContent = room ? 'Connected to private room' : 'Connected · finding PCs';
    $('broadcast-btn').disabled = cameraPending;
  };
  // Keep SDP and ICE messages in order across asynchronous browser operations.
  let messages = Promise.resolve();
  current.onmessage = event => {
    messages = messages.then(() => {
      if (socket !== current || current.readyState !== WebSocket.OPEN) return;
      return onMessage(JSON.parse(event.data));
    }).catch(error => {
      console.error(error);
      $('action-status').textContent = 'Could not connect to the camera. Try watching again.';
      if (watching) stopWatching();
    });
  };
  current.onclose = () => {
    if (socket !== current) return;
    $('connection-status').textContent = 'Disconnected · reconnecting…';
    $('broadcast-btn').disabled = true;
    stopWatching();
    for (const id of connections.keys()) closePeer(id);
    peers = [];
    renderPeers();
    reconnectTimer = setTimeout(connect, 3000);
  };
  current.onerror = () => { $('connection-status').textContent = 'Connection unavailable. Check your network and room link.'; };
}
function stopBroadcast() {
  localStream?.getTracks().forEach(track => track.stop());
  localStream = null;
  for (const id of connections.keys()) closePeer(id);
  send({ type: 'broadcast', live: false });
  video.srcObject = null;
  $('video-panel').hidden = true;
  $('broadcast-btn').textContent = 'Broadcast Camera';
  renderPeers();
}
$('broadcast-btn').addEventListener('click', async () => {
  if (localStream) { stopBroadcast(); return; }
  cameraPending = true;
  $('broadcast-btn').disabled = true;
  renderPeers();
  $('action-status').textContent = 'Opening camera…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost.');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    if (socket.readyState !== WebSocket.OPEN) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Connection lost. Try broadcasting after reconnecting.');
    }
    stopWatching();
    localStream = stream;
    video.srcObject = stream;
    video.muted = true;
    $('video-panel').hidden = false;
    $('video-title').textContent = 'Your camera';
    $('video-status').textContent = 'Live · other devices in this group can watch';
    $('broadcast-btn').textContent = 'Stop broadcast';
    send({ type: 'broadcast', live: true });
    stream.getVideoTracks()[0].addEventListener('ended', stopBroadcast, { once: true });
    $('action-status').textContent = '';
  } catch (error) {
    $('action-status').textContent = error.message;
  } finally {
    cameraPending = false;
    $('broadcast-btn').disabled = socket.readyState !== WebSocket.OPEN;
    renderPeers();
  }
});
nameInput.addEventListener('change', () => {
  nameInput.value = nameInput.value.trim() || 'PC';
  storage.set('streamline-device-name', nameInput.value);
  send({ type: 'hello', name: nameInput.value });
});
$('stop-watch-btn').addEventListener('click', stopWatching);
$('room-btn').addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.set('room', crypto.randomUUID());
  location.href = url.href;
});
$('network-btn').addEventListener('click', () => { location.href = location.origin; });
$('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('action-status').textContent = 'Room link copied. Open it on your other PCs.';
  } catch { $('action-status').textContent = 'Copy the room link from your address bar.'; }
});
$('fullscreen-btn').addEventListener('click', () => {
  if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
});
window.addEventListener('pagehide', () => {
  clearTimeout(reconnectTimer);
  socket.onclose = null;
  stopBroadcast();
  socket.close();
});
window.addEventListener('pageshow', event => { if (event.persisted) connect(); });
storage.set('streamline-device-name', nameInput.value);
renderPeers();
connect();
