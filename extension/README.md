# SyncWatch Web Player extension

This Manifest V3 extension synchronizes ordinary HTML5 video players. It never transfers video through SyncWatch: each viewer loads the original website and uses their own authorized account.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Open the extension, enter the SyncWatch server URL and six-digit room code, choose **Host** on the controlling browser and **Viewer** everywhere else, then enable it.
5. Open or refresh the same streaming page for each participant.

The extension requests access to web pages because it must locate and control their HTML5 `<video>` element. DRM, cross-origin player internals, provider terms, and autoplay rules still apply.
