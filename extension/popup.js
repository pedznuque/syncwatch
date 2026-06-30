const defaults = {
  enabled: true,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "viewer",
  syncwatchLastStatus: "Open a SyncWatch room to begin."
};
const fields = Object.fromEntries(["room", "role", "capture", "status"].map((id) => [id, document.getElementById(id)]));
let activeTabId = null;

function render(config) {
  fields.room.textContent = /^\d{6}$/.test(config.roomId) ? config.roomId : "Waiting for SyncWatch";
  fields.role.textContent = config.roomId ? (config.role === "host" ? "Host - automatic controller" : "Viewer - automatic sync") : "Automatic";
  fields.status.textContent = config.syncwatchLastStatus;
}

chrome.storage.local.get(defaults, render);

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  activeTabId = tab?.id;
  if (!Number.isInteger(activeTabId)) return;
  const context = await chrome.runtime.sendMessage({ type: "syncwatch:capture-context", tabId: activeTabId });
  fields.capture.hidden = !context?.isStreamTab;
  if (context?.isStreamTab) fields.status.textContent = `Stream tab for room ${context.roomId} detected.`;
});

fields.capture.addEventListener("click", async () => {
  if (!Number.isInteger(activeTabId)) return;
  fields.capture.disabled = true;
  fields.status.textContent = "Connecting this tab to SyncWatch...";
  const response = await chrome.runtime.sendMessage({ type: "syncwatch:start-capture", tabId: activeTabId });
  if (!response?.ok) {
    fields.capture.disabled = false;
    fields.status.textContent = response?.error || "Tab capture could not start.";
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (!changes.roomId && !changes.role && !changes.syncwatchLastStatus) return;
  chrome.storage.local.get(defaults, render);
});
