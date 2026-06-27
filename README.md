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
- Universal Web mode with a companion Chrome/Edge extension for HTML5 video synchronization
- Peer-to-peer browser-tab screen sharing for sites that cannot be embedded

## Important legal note

This project does not download, proxy, bypass DRM, or restream protected platforms like Netflix, Viu, or Bilibili. Those services must be opened through their official websites/apps using each viewer's own account.

For protected platforms, each user opens the official website with legitimate access. The companion extension synchronizes ordinary HTML5 playback state; Screen Share sends one browser-tab view to the room. Neither feature bypasses DRM.

## Web mode extension

Load the unpacked extension from `watch-party-app/extension` in `chrome://extensions`. Use **Controller** on the browser controlling the video and **Viewer** on the other browser. Both use the same room code. See `extension/README.md` for the short setup guide.

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
