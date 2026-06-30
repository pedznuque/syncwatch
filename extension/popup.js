const defaults = {
  enabled: false,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "viewer",
  syncwatchLastStatus: "Extension is off"
};
const fields = Object.fromEntries(["serverUrl", "roomId", "role", "enabled", "status", "save", "openStream", "useThisTab"].map((id) => [id, document.getElementById(id)]));

chrome.storage.local.get(defaults, (config) => {
  fields.serverUrl.value = config.serverUrl;
  fields.roomId.value = config.roomId;
  fields.role.value = config.role;
  fields.enabled.checked = config.enabled;
  fields.status.textContent = config.syncwatchLastStatus;
});

fields.save.addEventListener("click", () => {
  const roomId = fields.roomId.value.trim();
  const serverUrl = fields.serverUrl.value.trim().replace(/\/+$/, "");
  if (!/^\d{6}$/.test(roomId)) {
    fields.status.textContent = "Enter a six-digit room code.";
    return;
  }
  try {
    const url = new URL(serverUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    fields.status.textContent = "Enter a valid SyncWatch server URL.";
    return;
  }
  chrome.storage.local.set({ enabled: fields.enabled.checked, serverUrl, roomId, role: fields.role.value }, () => {
    fields.status.textContent = fields.enabled.checked ? "Saved - open or refresh the video page" : "Extension is off";
  });
});

fields.openStream.addEventListener("click", async () => {
  const config = await chrome.storage.local.get(defaults);
  if (!config.enabled || !/^\d{6}$/.test(config.roomId)) {
    fields.status.textContent = "Save and enable a valid room first.";
    return;
  }
  fields.status.textContent = "Finding the room stream...";
  const response = await chrome.runtime.sendMessage({ type: "syncwatch:open-stream-window", config });
  if (!response?.ok) {
    fields.status.textContent = response?.error || "No stream link is set in this room.";
    return;
  }
  fields.status.textContent = "Stream window opened - waiting for video.";
});

fields.useThisTab.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) {
    fields.status.textContent = "Could not select this tab.";
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "syncwatch:set-controller-tab", tabId: tab.id });
  fields.status.textContent = response?.ok ? "This tab is now the playback controller." : response?.error || "Could not select this tab.";
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.syncwatchLastStatus) fields.status.textContent = changes.syncwatchLastStatus.newValue;
});
