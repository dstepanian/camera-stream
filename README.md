# StreamLine

Find PCs with the app open and share a camera directly using WebRTC. The page and WebSocket signaling run on Cloudflare Workers with a hibernating SQLite-backed Durable Object. Video is sent between devices, not through the Worker. No local server installation is needed for the deployed app.

## Use the app

1. Open `https://stream.zromek.de` on each PC.
2. Give each device a recognizable name. The name is saved in that browser.
3. PCs whose connections have the same public IP address appear automatically.
4. Click **Broadcast Camera** on a PC and grant camera permission.
5. Click **Watch** beside that camera on another PC.
6. Click **Stop broadcast** to stop the camera, or **Stop watching** to disconnect a viewer.

Devices appear only while the app has an active connection. A browser tab can suspend or disconnect in the background. The app reconnects automatically when possible; a viewer can then select the camera again. Audio is disabled.

### Discovery and private rooms

Automatic discovery groups PCs by the public IP address Cloudflare sees. It does not scan a LAN or prove that devices share the same Wi-Fi. IPv6, VPNs and proxies can keep PCs in different groups. Carrier-grade NAT and shared internet gateways can put unrelated devices in the same group. IP addresses are not sent to browsers or displayed in the list.

Use **Create private room** and **Copy room link** to share an unguessable room URL with your other PCs. A private room works across different public IP addresses and does not list devices from the automatic group. **Anyone with the room link can discover its devices and watch its live cameras.** Automatic-group members can watch cameras shared in that group. A camera never starts until its user explicitly chooses to broadcast and grants browser permission. Use a private room for sensitive streams.

Names are labels supplied by users, not verified Windows hostnames. No accounts or recording are implemented. Rooms support up to 64 connected tabs.

## Local development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Wrangler. The same Cloudflare Worker and Durable Object run locally. Camera access works on localhost or HTTPS; an ordinary HTTP LAN address is not a secure camera origin.

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

## Deploy to Cloudflare

The included `wrangler.jsonc` binds the Worker to **stream.zromek.de**. The `zromek.de` zone must be active in the deploying Cloudflare account. Do not overwrite an existing service or conflicting DNS record without checking it first.

```sh
npx wrangler login
npm run deploy
```

Wrangler builds the Vite frontend, uploads static assets, creates the SQLite-backed Durable Object namespace, and attaches the custom domain with HTTPS. No API credentials belong in the repository. The worker is also available on its Cloudflare `workers.dev` address.

Cloudflare Workers Free supports the static assets and SQLite-backed Durable Objects used here, within its free quotas. Static asset requests are free; Worker and Durable Object compute have daily limits. Hibernation avoids active compute while signaling is idle. Domain registration or renewal remains separate. See [Cloudflare asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) and [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Connection troubleshooting

- Keep the app open on both devices and start a broadcast before selecting Watch.
- If a PC is missing, share a private room link and open exactly that link on both PCs.
- Allow camera and local-network permissions if the browser requests them.
- Camera permission denial leaves the app available so you can retry.
- WebRTC uses Cloudflare's public STUN server to help establish a direct connection. A STUN server does not relay video.
- Firewalls, guest-network isolation, VPNs and restrictive NAT can block direct WebRTC. A TURN relay may be needed for those networks; this deployment does not configure or promise a free TURN service.
- Each viewer creates a separate direct video connection, increasing broadcaster upload bandwidth.
- If Cloudflare's free quota is exceeded, signaling can fail until the quota resets. No video recording or media relay is hosted here.
