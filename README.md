# SyncWatch

SyncWatch is a React and Node.js watch-party app. Every participant loads video from its original source while the room synchronizes play, pause, seek, playback speed, and late joining.

## Features

- Synchronized website streaming through the Manifest V3 browser extension
- Embedded website player in the Windows desktop app
- Built-in synchronized YouTube and direct `.mp4` / `.webm` players
- Host controls with optional moderator access
- Cross-network WebRTC voice chat with STUN, TURN fallback, presence-aware signaling, and reconnects
- Text and picture chat, room invitations, six-digit room codes, and recent room history

Screen sharing and restreaming are intentionally not included. SyncWatch only synchronizes player controls; it does not download, proxy, rebroadcast, decrypt, or bypass DRM. Each viewer must have legal access to the original website and sign in with their own account. Provider terms, region restrictions, DRM, autoplay policies, and inaccessible player frames still apply.

## Browser extension

The extension controls the primary HTML5 `<video>` element on a streaming page.

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the [`extension`](extension) folder.
4. Open or refresh a SyncWatch room. The app automatically supplies the room code, role, and current stream link to the extension.

The GitHub Actions extension workflow also publishes a ready-to-unzip package as a build artifact.
The running SyncWatch app provides a **Download extension** button. When the host sets or changes a web link, each participant's extension automatically opens or reuses one local stream window. The host's detected HTML5 video becomes the controller automatically, while everyone else follows as a viewer. Remote controls wait for acknowledgement from the real player before changing their displayed state.

SyncWatch shows whether no link is set, a stream window is opening, or an HTML5 video was detected. Website video remains in its original provider window because browsers and protected sites do not permit silent cross-origin embedding or capture.

## Reliable voice across different networks

The backend returns STUN and TURN configuration from `/ice-config`. For production, set these environment variables to your own TURN service:

```txt
TURN_URLS=turn:relay.example.com:3478,turns:relay.example.com:5349
TURN_USERNAME=syncwatch
TURN_CREDENTIAL=replace-me
```

Without these variables, the app uses the Open Relay static-auth service as a development fallback. Voice media remains encrypted by WebRTC, including while relayed through TURN.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install --prefix server
npm install --prefix client
npm run dev --prefix server
npm run dev --prefix client
```

Open `http://localhost:5173`. To test from another device, use the computer's LAN address and configure `VITE_SERVER_URL` when the client and server use different origins.

## Desktop app

```bash
npm install --prefix desktop
npm run desktop
```

Set `SYNCWATCH_URL` to use another deployed app URL. Pushes affecting the desktop app build a Windows installer through GitHub Actions.

## Production notes

- Add authentication before a public launch.
- Use persistent storage for rooms and messages.
- Use Redis or another shared adapter when running multiple Socket.IO servers.
- Configure a managed TURN service for dependable voice capacity and monitor its bandwidth.
