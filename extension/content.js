const DEFAULT_CONFIG = {
  enabled: false,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "viewer"
};

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
    .filter((video) => video.isConnected)
    .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
}

async function publish(eventType) {
  if (!config.enabled || config.role !== "host" || !activeVideo || Date.now() < suppressUntil) return;
  const response = await request("POST", {
    eventType,
    url: location.href,
    title: document.title || "Web video",
    currentTime: Number(activeVideo.currentTime || 0),
    duration: Number.isFinite(activeVideo.duration) ? activeVideo.duration : 0,
    paused: activeVideo.paused,
    playbackRate: Number(activeVideo.playbackRate || 1),
    sourceId: chrome.runtime.id
  });
  setStatus(response?.ok ? `Host connected - ${eventType}` : response?.error || "Cannot reach SyncWatch");
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
  suppressUntil = Date.now() + 1200;
  const elapsed = state.paused ? 0 : Math.max(0, (Date.now() - Number(state.updatedAt || Date.now())) / 1000);
  const targetTime = Number(state.currentTime || 0) + elapsed * Number(state.playbackRate || 1);
  if (Math.abs(Number(activeVideo.currentTime || 0) - targetTime) > 1.25) {
    try { activeVideo.currentTime = targetTime; } catch {}
  }
  if (Number.isFinite(Number(state.playbackRate)) && activeVideo.playbackRate !== Number(state.playbackRate)) {
    activeVideo.playbackRate = Number(state.playbackRate);
  }
  if (state.paused) activeVideo.pause();
  else if (activeVideo.paused) activeVideo.play().catch(showPlaybackPrompt);
  setStatus(`Viewer connected - ${state.paused ? "paused" : "playing"}`);
}

async function poll() {
  if (!config.enabled || config.role !== "viewer") return;
  const response = await request("GET");
  if (response?.ok) await applyRemoteState(response.data);
  else setStatus(response?.error || "Cannot reach SyncWatch");
}

function restart() {
  clearInterval(pollTimer);
  clearInterval(scanTimer);
  activeVideo = null;
  lastSequence = -1;
  if (!config.enabled || !/^\d{6}$/.test(config.roomId)) {
    setStatus("Extension is off");
    return;
  }
  const scan = () => {
    const video = findPrimaryVideo();
    if (video) bindVideo(video);
    else setStatus("Connected - waiting for a video");
  };
  scan();
  scanTimer = setInterval(scan, 1500);
  if (config.role === "viewer") {
    poll();
    pollTimer = setInterval(poll, 1000);
  }
}

chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
  config = { ...DEFAULT_CONFIG, ...stored };
  restart();
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
