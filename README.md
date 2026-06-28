# SyncWatch React MVP

A React + Node.js watch-party starter app with:

- Improved cinema-style room interface
- Right-side chat panel that scrolls independently from the page
- Text chat
- Picture sharing in chat
- Voice chat with mic icon inside the chat panel
- Invite link and room code copying
- Leave-room button
- Recent room history on the home page
- Direct legal video URL sync
- YouTube in-room playback sync
- Extension-free Web mode that detects supported YouTube and direct video links
- Host-only playback controls with synchronized play, pause, seek, and late joining
- Separate peer-to-peer Screen Share option with tab audio
- Six-digit numeric room codes validated before joining
- Host-granted moderator playback controls
- Desktop embedded-browser mode for locally authenticated website video

## Important legal note

This project does not download, proxy, bypass DRM, or restream protected platforms like Netflix, Viu, or Bilibili. Those services must be opened through their official websites/apps using each viewer's own account.

In **Web** mode, the host pastes a supported YouTube or direct `.mp4`/`.webm` link. SyncWatch loads the player independently for every participant and keeps it synchronized under host control. For unsupported or protected platforms, use the separate **Screen Share** option, choose the tab playing the video, and enable **Share tab audio**. No browser extension is required, and neither mode bypasses DRM.

The Windows desktop app extends Web mode to ordinary HTML5 video players on websites such as Bilibili or Viu. Every participant loads the original site locally and signs in with their own account. Provider DRM, terms, region restrictions, and players that hide video inside inaccessible frames can still prevent synchronization; Screen Share remains the fallback.

## Desktop app

Start the web client and server locally, then run:

```bash
npm install --prefix desktop
npm run desktop
```

Set `SYNCWATCH_URL` to point the desktop shell at a different deployed server. Pushing desktop changes to `main` runs the Windows packaging workflow and uploads the installer as a GitHub Actions artifact.

## Run the backend

```bash
cd watch-party-app/server
npm install
npm run dev
```

If `nodemon is not recognized`, run:

```bash
npm install nodemon --save-dev
npm run dev
```

Or use the non-auto-reload command:

```bash
npm start
```

## Run the frontend

Open a second terminal:

```bash
cd watch-party-app/client
npm install
npm run dev
```

Open:

```txt
http://localhost:5173
```

## How to test with friends locally

1. Start the server.
2. Start the client.
3. Create a room.
4. Copy the invite link.
5. Open the same invite link in another browser tab or another device on the same network.

For phone testing on the same Wi-Fi, replace `localhost` with your computer's local IP address and configure `VITE_SERVER_URL` if needed.

## Production notes

- Add authentication before public deployment.
- Store rooms/messages in a real database like MongoDB or PostgreSQL.
- Use Redis for room state if scaling to multiple servers.
- Use a TURN server for reliable WebRTC voice chat.
- Keep protected streaming services in official-link mode unless you have written licensing and platform API permission.
