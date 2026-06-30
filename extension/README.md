# SyncWatch Web Player extension

This Manifest V3 extension synchronizes ordinary HTML5 video players. It never transfers video through SyncWatch: each viewer loads the original website and uses their own authorized account.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Open or refresh a SyncWatch room. No popup setup is required.

Opening a SyncWatch room automatically configures its room code and role. When the host sets or changes a link, the extension opens or updates one stream window for every participant. The host's strongest HTML5 video candidate becomes the controller automatically; viewer windows follow it. A detected HTTP/HTTPS media source is relayed only to that participant's own SyncWatch tab for automatic direct embedding. If direct playback is blocked, click the extension on the stream tab and choose **Show this video in SyncWatch**. Chrome requires this one user invocation before tab capture. A controller command is shown as applied only after the real player acknowledges its state.

The extension requests access to web pages because it must locate and control their HTML5 `<video>` element. DRM, cross-origin player internals, provider terms, and autoplay rules still apply.
