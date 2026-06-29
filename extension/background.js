const DEFAULT_SERVER = "https://syncwatch-tgzg.onrender.com";

function endpoint(config) {
  const serverUrl = String(config.serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
  const parsed = new URL(serverUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Server URL must use HTTP or HTTPS.");
  if (!/^\d{6}$/.test(String(config.roomId || ""))) throw new Error("Enter a six-digit room code.");
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/rooms/${config.roomId}/web-sync`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "syncwatch:request") return false;
  (async () => {
    try {
      const url = endpoint(message.config || {});
      const options = message.method === "POST"
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.body || {}) }
        : { method: "GET", cache: "no-store" };
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `SyncWatch returned ${response.status}.`);
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "SyncWatch request failed." });
    }
  })();
  return true;
});
