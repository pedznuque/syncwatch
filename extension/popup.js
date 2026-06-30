const defaults = {
  enabled: true,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "viewer",
  syncwatchLastStatus: "Open a SyncWatch room to begin."
};
const fields = Object.fromEntries(["room", "role", "status"].map((id) => [id, document.getElementById(id)]));

function render(config) {
  fields.room.textContent = /^\d{6}$/.test(config.roomId) ? config.roomId : "Waiting for SyncWatch";
  fields.role.textContent = config.roomId ? (config.role === "host" ? "Host - automatic controller" : "Viewer - automatic sync") : "Automatic";
  fields.status.textContent = config.syncwatchLastStatus;
}

chrome.storage.local.get(defaults, render);

chrome.storage.onChanged.addListener((changes) => {
  if (!changes.roomId && !changes.role && !changes.syncwatchLastStatus) return;
  chrome.storage.local.get(defaults, render);
});
