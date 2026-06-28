# SyncWatch Web Video Sync extension

1. Open `chrome://extensions` in Chrome or Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Open the extension on both browsers and enter the same SyncWatch room code.
   The production server is already set to `https://syncwatch-tgzg.onrender.com`.
5. Set the person controlling playback to **Controller** and the other person to **Viewer**.
6. Enable synchronization. The controller opens and plays a web video; the viewer uses **Open synced video** once, then play/pause/seek follow automatically.

The extension synchronizes playback state. It does not download, decrypt, proxy, or bypass DRM. Each viewer needs legitimate access to the website. This mode gives the best quality because every viewer receives video directly from the original provider; screen sharing is only a fallback and may require TURN relay bandwidth.
