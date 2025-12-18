# StreamLine - Local Network Camera Broadcaster

StreamLine is a simple, high-performance web application that allows you to broadcast your laptop's camera feed to other devices on your local network (LAN) using WebRTC and Socket.IO.

## Features
- **Real-time Streaming**: Low-latency video streaming using WebRTC peer-to-peer technology.
- **Local Network Access**: View the stream from any device (phone, tablet, PC) on the same Wi-Fi.
- **Modern UI**: Sleek, dark-mode interface with a "Wow" factor.
- **Fullscreen Mode**: View the camera feed in fullscreen.
- **Broadcast & Watch Modes**: Switch between being the broadcaster or a viewer.

## Prerequisites
- **Node.js**: Ensure Node.js (v14 or higher) is installed on your machine.
- **Camera**: A webcam or connected camera device.
- **Network**: All devices must be connected to the same local network (Wi-Fi/LAN).

## Installation

1.  Clone or download this repository.
2.  Navigate to the project directory:
    ```bash
    cd camera-stream
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```

## Usage

### 1. Start the Server
Run the following command to start the application:
```bash
npm run dev
```

### 2. Broadcast (Host)
- The terminal will display a local address (e.g., `http://localhost:3000`).
- Open this URL on your laptop's browser.
- Click **"Broadcast Camera"**.
- Grant camera permissions when prompted.
- The status should change to "Live".

### 3. Watch (Client)
- The terminal will also display a **Network** address (e.g., `http://192.168.1.5:3000`).
- Open this URL on any other device on the same network.
- Click **"Watch Stream"**.
- The video feed should appear shortly.

## Troubleshooting
- **No Video on Viewer?**
    - Check the "ICE State" log on the viewer screen.
    - If it stays on "checking" or "failed", it's likely a **Firewall** issue.
    - **Windows**: Allow `node.exe` or the port `3000` through Windows Defender Firewall.
- **Browser Permissions**: Ensure the browser has permission to access the camera on the broadcaster side. Note that some browsers restrict camera access on non-secure (HTTP) origins unless it's `localhost`. The viewer does not need camera access.

## Tech Stack
- **Frontend**: Vanilla JS, HTML5, CSS3 (Vite)
- **Backend**: Node.js, Express
- **Real-time**: Socket.IO (Signaling), WebRTC (Streaming)

## License
MIT
