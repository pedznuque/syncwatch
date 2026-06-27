let config = null;
let lastPublished = "";
let lastPublishAt = 0;
let lastRemoteSeq = 0;
let applyingRemoteUntil = 0;
let banner = null;

function message(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!response?.ok) return reject(new Error(response?.error || "Extension request failed"));
      resolve(response.data);
    });
  });
}

function findMainVideo() {
  return [...document.querySelectorAll("video")]
    .filter((video) => video.readyState > 0)
    .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
}

function samePage(a, b) {
  try {
    const first = new URL(a);
    const second = new URL(b);
    return first.origin === second.origin && first.pathname.replace(/\/$/, "") === second.pathname.replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

function hideBanner() {
  banner?.remove();
  banner = null;
}

function showBanner(text, actionLabel, action) {
  if (!banner) {
    banner = document.createElement("div");
    banner.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:12px;max-width:min(680px,calc(100vw - 24px));padding:12px 14px;border:1px solid #6366f1;border-radius:12px;background:#0f172a;color:#fff;font:14px system-ui;box-shadow:0 12px 40px #0008";
    document.documentElement.appendChild(banner);
  }
  banner.replaceChildren();
  const label = document.createElement("span");
  label.textContent = text;
  label.style.flex = "1";
  banner.appendChild(label);
  if (actionLabel) {
    const button = document.createElement("button");
    button.textContent = actionLabel;
    button.style.cssText = "padding:8px 12px;border:0;border-radius:8px;background:#6366f1;color:white;cursor:pointer";
    button.addEventListener("click", action, { once: true });
    banner.appendChild(button);
  }
}

function stateFromVideo(video) {
  return {
    url: window === window.top ? location.href : (document.referrer || location.href),
    title: document.title || "Web video",
    currentTime: Number(video.currentTime || 0),
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused,
    playbackRate: video.playbackRate || 1,
    sourceId: config.deviceId
  };
}

async function publish(video, force = false) {
  if (!config?.enabled || config.role !== "controller" || !config.roomId || Date.now() < applyingRemoteUntil) return;
  const state = stateFromVideo(video);
  const signature = `${state.url}|${state.paused}|${Math.round(state.currentTime * 2)}|${state.playbackRate}`;
  if (!force && Date.now() - lastPublishAt < 1800) return;
  if (!force && signature === lastPublished && Date.now() - lastPublishAt < 1200) return;
  lastPublished = signature;
  lastPublishAt = Date.now();
  try {
    await message({ type: "api", path: `/rooms/${encodeURIComponent(config.roomId)}/web-sync`, options: { method: "POST", body: state } });
    showBanner(`SyncWatch Controller · ${state.paused ? "Paused" : "Playing"}`, null, null);
  } catch (error) {
    showBanner(`SyncWatch: ${error.message}`, null, null);
  }
}

async function followRemote() {
  if (!config?.enabled || config.role !== "viewer" || !config.roomId) return;
  try {
    const remote = await message({ type: "api", path: `/rooms/${encodeURIComponent(config.roomId)}/web-sync` });
    if (!remote?.url || remote.sourceId === config.deviceId || remote.seq === lastRemoteSeq) return;
    lastRemoteSeq = remote.seq;
    const currentPageUrl = window === window.top ? location.href : (document.referrer || location.href);
    if (!samePage(currentPageUrl, remote.url)) {
      showBanner(`SyncWatch is playing “${remote.title || "a web video"}” on another page.`, "Open video", () => { location.href = remote.url; });
      return;
    }
    const video = findMainVideo();
    if (!video) {
      showBanner("SyncWatch found the page and is waiting for its video player.", null, null);
      return;
    }
    applyingRemoteUntil = Date.now() + 1000;
    if (Math.abs(video.currentTime - remote.currentTime) > 1.25) video.currentTime = remote.currentTime;
    if (remote.playbackRate) video.playbackRate = remote.playbackRate;
    if (remote.paused) {
      video.pause();
      showBanner("SyncWatch Viewer · Paused", null, null);
    } else {
      try {
        await video.play();
        hideBanner();
      } catch {
        showBanner("Click once to allow synchronized playback.", "Play", async () => { await video.play(); hideBanner(); });
      }
    }
  } catch (error) {
    showBanner(`SyncWatch: ${error.message}`, null, null);
  }
}

document.addEventListener("play", (event) => event.target instanceof HTMLVideoElement && publish(event.target, true), true);
document.addEventListener("pause", (event) => event.target instanceof HTMLVideoElement && publish(event.target, true), true);
document.addEventListener("seeked", (event) => event.target instanceof HTMLVideoElement && publish(event.target, true), true);

async function refreshConfig() {
  try {
    config = await message({ type: "get-config" });
    if (!config.enabled) hideBanner();
  } catch {}
}

refreshConfig();
setInterval(refreshConfig, 3000);
setInterval(() => {
  if (config?.role === "controller") {
    const video = findMainVideo();
    if (video) publish(video);
  } else followRemote();
}, 1100);
