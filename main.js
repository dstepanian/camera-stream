import './style.css'
import { io } from "socket.io-client";

const socket = io();
const appContainer = document.getElementById('app');

// State
let peerConnections = {}; // id -> RTCPeerConnection
const config = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302"]
    }
  ]
};

// Initial UI
appContainer.innerHTML = `
  <div class="overlay" id="start-overlay">
    <div class="content">
        <h1>StreamLine</h1>
        <p>Choose your mode</p>
        <div class="btn-group">
            <button id="broadcast-btn">Broadcast Camera</button>
            <button id="watch-btn" class="secondary">Watch Stream</button>
        </div>
        <p class="status" id="status-msg">Ready to connect...</p>
    </div>
  </div>
`;

const broadcastBtn = document.getElementById('broadcast-btn');
const watchBtn = document.getElementById('watch-btn');
const statusMsg = document.getElementById('status-msg');

broadcastBtn.addEventListener('click', startBroadcast);
watchBtn.addEventListener('click', startWatching);

// -- BROADCASTER --
async function startBroadcast() {
  broadcastBtn.disabled = true;
  watchBtn.disabled = true;
  statusMsg.textContent = "Initializing camera...";

  // Create UI
  appContainer.innerHTML = `
      <video id="local-video" autoplay playsinline muted class="active"></video>
      <div class="controls">
          <div class="info-pill"><span class="recording-dot"></span>Broadcasting</div>
      </div>
    `;
  const videoElement = document.getElementById('local-video');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false // Audio off for now to avoid feedback
    });
    videoElement.srcObject = stream;
    socket.emit("broadcaster");
    statusMsg.textContent = "Live.";

    socket.on("watcher", id => {
      const peerConnection = new RTCPeerConnection(config);
      peerConnections[id] = peerConnection;

      // Add tracks to connection
      stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

      // On ICE candidate
      peerConnection.onicecandidate = event => {
        if (event.candidate) {
          socket.emit("candidate", id, event.candidate);
        }
      };

      // Create Offer
      peerConnection.createOffer()
        .then(sdp => peerConnection.setLocalDescription(sdp))
        .then(() => {
          socket.emit("offer", id, peerConnection.localDescription);
        });
    });

    socket.on("answer", (id, description) => {
      peerConnections[id].setRemoteDescription(description);
    });

    socket.on("candidate", (id, candidate) => {
      peerConnections[id].addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on("disconnectPeer", id => {
      if (peerConnections[id]) {
        peerConnections[id].close();
        delete peerConnections[id];
      }
    });

  } catch (error) {
    console.error(error);
    alert("Camera access denied or error: " + error.message);
    location.reload();
  }
}

// -- VIEWER --
function startWatching() {
  broadcastBtn.disabled = true;
  watchBtn.disabled = true;
  statusMsg.textContent = "Waiting for stream...";

  appContainer.innerHTML = `
      <video id="remote-video" autoplay playsinline controls class="active"></video>
      <div style="position:absolute; top:20px; left:20px; z-index:20; background:rgba(0,0,0,0.5); padding:10px; border-radius:8px;">
        <p id="watch-status" style="margin:0; color:white; font-size:14px;">Connecting...</p>
      </div>
      <div class="controls">
          <div class="info-pill" style="color:#646cff;">Watching Stream</div>
      </div>
    `;
  const videoElement = document.getElementById('remote-video');
  const watchStatus = document.getElementById('watch-status');

  socket.emit("watcher");

  let peerConnection; // Viewers only connect to one broadcaster
  let broadcasterId;

  socket.on("offer", (id, description) => {
    broadcasterId = id;
    peerConnection = new RTCPeerConnection(config);

    peerConnection.oniceconnectionstatechange = () => {
      watchStatus.textContent = "ICE: " + peerConnection.iceConnectionState;
      console.log("ICE State:", peerConnection.iceConnectionState);
    };

    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        socket.emit("candidate", id, event.candidate);
      }
    };

    peerConnection.ontrack = event => {
      console.log("Track received:", event.streams[0]);
      videoElement.srcObject = event.streams[0];
      watchStatus.textContent = "Stream connected. Playing...";
    };

    peerConnection.setRemoteDescription(description)
      .then(() => peerConnection.createAnswer())
      .then(sdp => peerConnection.setLocalDescription(sdp))
      .then(() => {
        socket.emit("answer", id, peerConnection.localDescription);
      });
  });

  socket.on("candidate", (id, candidate) => {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(e => console.error(e));
  });

  socket.on("broadcaster", () => {
    socket.emit("watcher");
  });

  socket.on("disconnectPeer", (id) => {
    if (broadcasterId && id === broadcasterId) {
      if (peerConnection) peerConnection.close();
      alert("Broadcast ended.");
      location.reload();
    }
  });
}
