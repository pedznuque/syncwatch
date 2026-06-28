const { ipcRenderer } = require("electron");

let suppressUntil = 0;
let lastProgressSent = 0;

function sendState(video, eventType) {
  if (Date.now() < suppressUntil) return;
  ipcRenderer.sendToHost("syncwatch:video-state", {
    eventType,
    url: location.href,
    title: document.title,
    currentTime: Number(video.currentTime || 0),
    duration: Number(video.duration || 0),
    paused: video.paused,
    playbackRate: Number(video.playbackRate || 1)
  });
}

function bindVideo(video) {
  if (video.dataset.syncwatchBound) return;
  video.dataset.syncwatchBound = "true";
  ipcRenderer.sendToHost("syncwatch:video-found", { url: location.href, title: document.title });
  video.addEventListener("play", () => sendState(video, "play"));
  video.addEventListener("pause", () => sendState(video, "pause"));
  video.addEventListener("seeked", () => sendState(video, "seek"));
  video.addEventListener("ratechange", () => sendState(video, "rate"));
  video.addEventListener("loadedmetadata", () => sendState(video, "ready"));
  video.addEventListener("timeupdate", () => {
    if (Date.now() - lastProgressSent < 2000) return;
    lastProgressSent = Date.now();
    sendState(video, "progress");
  });
}

function scan() {
  document.querySelectorAll("video").forEach(bindVideo);
}

window.addEventListener("DOMContentLoaded", () => {
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
});

ipcRenderer.on("syncwatch:command", async (_event, command) => {
  suppressUntil = Date.now() + 900;
  const videos = [...document.querySelectorAll("video")];
  for (const video of videos) {
    if (Number.isFinite(command.currentTime) && Math.abs(video.currentTime - command.currentTime) > 0.75) {
      try { video.currentTime = command.currentTime; } catch {}
    }
    if (command.type === "play" || (command.type === "sync" && command.isPlaying)) {
      try { await video.play(); } catch {}
    }
    if (command.type === "pause" || (command.type === "sync" && !command.isPlaying)) video.pause();
  }
});
