const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "viewer",
  autoFullscreen: true
};
const HOST_SOURCE_ID = `extension-host:${chrome.runtime.id}`;
let hostSourceId = HOST_SOURCE_ID;

let config = { ...DEFAULT_CONFIG };
let activeVideo = null;
let lastSequence = -1;
let suppressUntil = 0;
let lastPublished = 0;
let pollTimer = null;
let scanTimer = null;
const boundVideos = new WeakSet();

function request(method, body) {
  return chrome.runtime.sendMessage({ type: "syncwatch:request", method, config, body });
}

function setStatus(text) {
  chrome.storage.local.set({ syncwatchLastStatus: text });
}

function collectVideos(root, output = []) {
  root.querySelectorAll?.("video").forEach((video) => output.push(video));
  root.querySelectorAll?.("*").forEach((element) => {
    if (element.shadowRoot) collectVideos(element.shadowRoot, output);
  });
  return output;
}

function findPrimaryVideo() {
  return collectVideos(document)
    .filter((video) => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return video.isConnected && rect.width >= 120 && rect.height >= 68
        && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    })
    .sort((a, b) => scoreVideo(b) - scoreVideo(a))[0] || null;
}

function scoreVideo(video) {
  const rect = video.getBoundingClientRect();
  const area = rect.width * rect.height;
  return area
    + (video.readyState >= 2 ? 250_000 : 0)
    + (!video.paused ? 500_000 : 0)
    + (Number.isFinite(video.duration) && video.duration > 30 ? 150_000 : 0);
}

function isSyncWatchRoomPage() {
  let serverOrigin;
  try { serverOrigin = new URL(config.serverUrl || DEFAULT_CONFIG.serverUrl).origin; } catch { return false; }
  return location.origin === serverOrigin && /^\/room\/\d{6}\/?$/.test(location.pathname);
}

async function detectRoomFromPage() {
  if (!isSyncWatchRoomPage()) return false;
  const roomId = location.pathname.match(/^\/room\/(\d{6})/)?.[1];
  if (!roomId) return false;
  await chrome.storage.local.set({
    roomId,
    serverUrl: location.origin,
    enabled: true,
    syncwatchLastStatus: `Room ${roomId} detected automatically`
  });
  return true;
}

async function publish(eventType) {
  if (!config.enabled || config.role !== "host" || !activeVideo || Date.now() < suppressUntil) return;
  lastPublished = Date.now();
  const response = await request("POST", {
    eventType,
    url: location.href,
    title: document.title || "Web video",
    currentTime: Number(activeVideo.currentTime || 0),
    duration: Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0,
    paused: activeVideo.paused,
    playbackRate: Number(activeVideo.playbackRate || 1),
    sourceId: HOST_SOURCE_ID,
    playerDetected: true
  });
  if (response?.ignored) {
    setStatus("Another stream tab is the active controller.");
    return;
  }
  if (response?.data?.sourceId) hostSourceId = response.data.sourceId;
  setStatus(response?.ok ? `Host connected - ${eventType}` : response?.error || "Cannot reach SyncWatch");
}

async function acknowledgeCommand(commandId, error = "") {
  if (!activeVideo || !commandId) return;
  await request("POST", {
    eventType: "command-ack",
    url: location.href,
    title: document.title || "Web video",
    currentTime: Number(activeVideo.currentTime || 0),
    duration: Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0,
    paused: activeVideo.paused,
    playbackRate: Number(activeVideo.playbackRate || 1),
    sourceId: HOST_SOURCE_ID,
    playerDetected: true,
    ackCommandId: commandId,
    commandError: error
  });
}

function bindVideo(video) {
  if (activeVideo === video) return;
  activeVideo = video;
  if (!boundVideos.has(video)) {
    boundVideos.add(video);
    const publishIfActive = (eventType) => activeVideo === video && publish(eventType);
    video.addEventListener("play", () => publishIfActive("play"));
    video.addEventListener("pause", () => publishIfActive("pause"));
    video.addEventListener("seeked", () => publishIfActive("seek"));
    video.addEventListener("ratechange", () => publishIfActive("rate"));
    video.addEventListener("loadedmetadata", () => publishIfActive("ready"));
    video.addEventListener("timeupdate", () => {
      if (activeVideo !== video || Date.now() - lastPublished < 2000) return;
      lastPublished = Date.now();
      publish("progress");
    });
  }
  setStatus(`Video detected - ${config.role}`);
  chrome.runtime.sendMessage({
    type: "syncwatch:register-stream-tab",
    roomId: config.roomId,
    autoFullscreen: config.autoFullscreen
  });
  if (config.role === "host") publish("ready");
}

function showPlaybackPrompt() {
  if (document.getElementById("syncwatch-playback-prompt")) return;
  const button = document.createElement("button");
  button.id = "syncwatch-playback-prompt";
  button.textContent = "Enable synchronized playback";
  Object.assign(button.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    padding: "12px 16px", border: "0", borderRadius: "10px", color: "white",
    background: "#4f46e5", font: "600 14px system-ui", cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)"
  });
  button.addEventListener("click", async () => {
    try { await activeVideo?.play(); button.remove(); } catch {}
  });
  document.documentElement.appendChild(button);
}

async function applyRemoteState(state) {
  if (!activeVideo || !state || state.seq <= lastSequence) return;
  lastSequence = state.seq;
  if (config.role === "host" && state.sourceId === hostSourceId) return;
  suppressUntil = Date.now() + 1200;
  const elapsed = state.paused ? 0 : Math.max(0, (Date.now() - Number(state.updatedAt || Date.now())) / 1000);
  const targetTime = Number(state.currentTime || 0) + elapsed * Number(state.playbackRate || 1);
  if (Math.abs(Number(activeVideo.currentTime || 0) - targetTime) > 1.25) {
    try { activeVideo.currentTime = targetTime; } catch {}
  }
  if (Number.isFinite(Number(state.playbackRate)) && activeVideo.playbackRate !== Number(state.playbackRate)) {
    activeVideo.playbackRate = Number(state.playbackRate);
  }
  let commandError = "";
  if (state.paused) activeVideo.pause();
  else if (activeVideo.paused) {
    try { await activeVideo.play(); }
    catch {
      commandError = "Playback was blocked. Click Enable synchronized playback in the stream window.";
      showPlaybackPrompt();
    }
  }
  if (config.role === "host" && state.sourceId === "syncwatch-app" && state.commandId) {
    await acknowledgeCommand(state.commandId, commandError);
  }
  setStatus(`${config.role === "host" ? "Controller" : "Viewer"} connected - ${activeVideo.paused ? "paused" : "playing"}`);
}

async function poll() {
  if (!config.enabled) return;
  const response = await request("GET");
  if (response?.ok) await applyRemoteState(response.data);
  else setStatus(response?.error || "Cannot reach SyncWatch");
}

function restart() {
  clearInterval(pollTimer);
  clearInterval(scanTimer);
  activeVideo = null;
  lastSequence = -1;
  hostSourceId = HOST_SOURCE_ID;
  if (isSyncWatchRoomPage()) {
    setStatus(`Room ${config.roomId || ""} detected automatically`.trim());
    return;
  }
  if (!config.enabled || !/^\d{6}$/.test(config.roomId)) {
    setStatus("Extension is off");
    return;
  }
  const scan = () => {
    const video = findPrimaryVideo();
    if (video) {
      bindVideo(video);
      if (config.role === "host" && activeVideo === video && Date.now() - lastPublished > 3000) publish("heartbeat");
    }
    else setStatus("Connected - waiting for a video");
  };
  scan();
  scanTimer = setInterval(scan, 1500);
  poll();
  pollTimer = setInterval(poll, 1000);
}

chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
  config = { ...DEFAULT_CONFIG, ...stored };
  detectRoomFromPage().then(restart);
});

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin || !isSyncWatchRoomPage()) return;
  if (event.data?.type !== "syncwatch:mirror-source-audio") return;
  const response = await chrome.runtime.sendMessage({
    type: "syncwatch:set-stream-muted",
    roomId: config.roomId,
    muted: Boolean(event.data.muted)
  });
  window.postMessage({
    type: "syncwatch:mirror-source-audio-result",
    muted: Boolean(event.data.muted),
    ok: Boolean(response?.ok),
    error: response?.error || ""
  }, location.origin);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let configChanged = false;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (changes[key]) {
      config[key] = changes[key].newValue;
      configChanged = true;
    }
  }
  if (configChanged) restart();
});
