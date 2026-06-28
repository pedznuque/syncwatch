const DEFAULTS = {
  enabled: false,
  serverUrl: "https://syncwatch-tgzg.onrender.com",
  roomId: "",
  role: "controller",
  deviceId: ""
};

async function getConfig() {
  const saved = await chrome.storage.local.get(null);
  const stored = { ...DEFAULTS, ...saved };
  if (!saved.serverUrl || saved.serverUrl === "http://localhost:5000") {
    stored.serverUrl = DEFAULTS.serverUrl;
    await chrome.storage.local.set({ serverUrl: stored.serverUrl });
  }
  if (!stored.deviceId) {
    stored.deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ deviceId: stored.deviceId });
  }
  return stored;
}

async function apiRequest(path, options = {}) {
  const config = await getConfig();
  const serverUrl = String(config.serverUrl || DEFAULTS.serverUrl).replace(/\/$/, "");
  if (!/^https?:\/\//i.test(serverUrl)) throw new Error("Server URL must start with http:// or https://");
  const response = await fetch(`${serverUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "get-config") return getConfig();
    if (message.type === "save-config") {
      const next = { ...message.config };
      await chrome.storage.local.set(next);
      return getConfig();
    }
    if (message.type === "api") return apiRequest(message.path, message.options);
    throw new Error("Unknown extension request");
  })().then((data) => sendResponse({ ok: true, data })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
