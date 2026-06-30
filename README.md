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
4. Enter the SyncWatch server URL and room code.
5. Select **Host / controller** for the person controlling playback and **Viewer** for everyone else.
6. Enable the extension, then open or refresh the same streaming page in each browser.

The GitHub Actions extension workflow also publishes a ready-to-unzip package as a build artifact.
The running SyncWatch app provides a **Download extension** button, plus **Open stream window** and **Mirror stream window** controls after a web link is set. The extension detects the room code from an open SyncWatch room, can fullscreen the actual stream window, and keeps that source tab silent while its high-resolution local mirror plays the captured audio. Remote controls wait for acknowledgement from the real player before changing their displayed state.

SyncWatch shows whether no link is set, a link is waiting for the extension, or an HTML5 video was detected. Mirroring uses the browser's window/tab chooser instead of iframe embedding. It stays local to that viewer and can enter fullscreen with floating chat and shared microphone controls. DRM-protected video may still appear black when captured.

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
