const DEFAULT_SERVER = "https://syncwatch-tgzg.onrender.com";
let controller = null;

async function getController() {
  if (controller) return controller;
  const stored = await chrome.storage.session.get("syncwatchController");
  controller = stored.syncwatchController || null;
  return controller;
}

async function setController(nextController) {
  controller = nextController;
  if (nextController) await chrome.storage.session.set({ syncwatchController: nextController });
  else await chrome.storage.session.remove("syncwatchController");
}

async function getStreamTabs() {
  const stored = await chrome.storage.session.get("syncwatchStreamTabs");
  return stored.syncwatchStreamTabs || {};
}

async function setStreamTab(roomId, tabId) {
  const streamTabs = await getStreamTabs();
  streamTabs[roomId] = tabId;
  await chrome.storage.session.set({ syncwatchStreamTabs: streamTabs });
}

async function fullscreenControllerWindow(activeController) {
  if (activeController?.fullscreenApplied) return activeController;
  const tab = await chrome.tabs.get(activeController.tabId);
  await chrome.windows.update(tab.windowId, { state: "fullscreen" });
  const updatedController = { ...activeController, fullscreenApplied: true };
  await setController(updatedController);
  return updatedController;
}

async function returnFocusToSyncWatch(config, activeController) {
  if (!activeController?.returnFocus) return;
  let origin;
  try { origin = new URL(config.serverUrl || DEFAULT_SERVER).origin; } catch { return; }
  const tabs = await chrome.tabs.query({});
  const syncWatchTab = tabs.find((tab) => {
    try { return tab.id !== activeController.tabId && new URL(tab.url).origin === origin; } catch { return false; }
  });
  await setController({ ...activeController, returnFocus: false });
  if (!Number.isInteger(syncWatchTab?.id)) return;
  await chrome.tabs.update(syncWatchTab.id, { active: true });
  await chrome.windows.update(syncWatchTab.windowId, { focused: true });
}

function endpoint(config) {
  const serverUrl = String(config.serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
  const parsed = new URL(serverUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Server URL must use HTTP or HTTPS.");
  if (!/^\d{6}$/.test(String(config.roomId || ""))) throw new Error("Enter a six-digit room code.");
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}/rooms/${config.roomId}/web-sync`;
}

async function roomRequest(message, sender) {
  const config = message.config || {};
  const url = endpoint(config);
  const body = { ...(message.body || {}) };

  if (message.method === "POST" && config.role === "host" && /^extension-host:/.test(body.sourceId || "")) {
    const tabId = sender.tab?.id;
    const frameId = Number(sender.frameId || 0);
    if (!Number.isInteger(tabId)) throw new Error("The controller tab is unavailable.");
    let activeController = await getController();
    if (!activeController) {
      activeController = { tabId, frameId, returnFocus: false, fullscreenApplied: false };
      await setController(activeController);
    }
    if (activeController.tabId === tabId && activeController.frameId === null) {
      activeController = { ...activeController, frameId };
      await setController(activeController);
    }
    if (activeController.tabId !== tabId || activeController.frameId !== frameId) {
      return { ok: true, ignored: true, error: "Another stream tab is the active controller." };
    }
    body.sourceId = `extension-host:${chrome.runtime.id}:${tabId}:${frameId}`;
  }

  const options = message.method === "POST"
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET", cache: "no-store" };
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `SyncWatch returned ${response.status}.`);
  if (message.method === "POST" && config.role === "host" && /^extension-host:/.test(body.sourceId || "") && !data.ignored) {
    const activeController = await getController();
    if (activeController?.tabId === sender.tab?.id && activeController?.frameId === Number(sender.frameId || 0)) {
      const updatedController = config.autoFullscreen === false
        ? activeController
        : await fullscreenControllerWindow(activeController);
      await returnFocusToSyncWatch(config, updatedController);
    }
  }
  return { ok: true, data, ignored: Boolean(data.ignored) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "syncwatch:request") {
        sendResponse(await roomRequest(message, sender));
        return;
      }
      if (message?.type === "syncwatch:set-controller-tab") {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId)) throw new Error("Choose a valid stream tab.");
        await setController({ tabId, frameId: null, returnFocus: false, fullscreenApplied: false });
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "syncwatch:register-stream-tab") {
        const roomId = String(message.roomId || "");
        const tabId = sender.tab?.id;
        if (!/^\d{6}$/.test(roomId) || !Number.isInteger(tabId)) throw new Error("The stream tab could not be registered.");
        await setStreamTab(roomId, tabId);
        if (message.autoFullscreen !== false) {
          const streamWindow = await chrome.windows.get(sender.tab.windowId);
          if (streamWindow.state !== "fullscreen") await chrome.windows.update(sender.tab.windowId, { state: "fullscreen" });
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "syncwatch:set-stream-muted") {
        const roomId = String(message.roomId || "");
        const streamTabs = await getStreamTabs();
        const tabId = streamTabs[roomId];
        if (!Number.isInteger(tabId)) throw new Error("Open the stream once so the extension can identify its tab.");
        await chrome.tabs.update(tabId, { muted: Boolean(message.muted) });
        sendResponse({ ok: true, muted: Boolean(message.muted) });
        return;
      }
      if (message?.type === "syncwatch:open-stream-window") {
        const roomState = await roomRequest({ type: "syncwatch:request", method: "GET", config: message.config }, sender);
        if (!roomState.data?.url) throw new Error("No stream link is set in this room.");
        const created = await chrome.windows.create({
          url: roomState.data.url,
          type: "popup",
          width: 1280,
          height: 800,
          focused: true
        });
        let tabId = created.tabs?.[0]?.id;
        if (!Number.isInteger(tabId)) {
          const [activeTab] = await chrome.tabs.query({ windowId: created.id, active: true });
          tabId = activeTab?.id;
        }
        if (Number.isInteger(tabId)) {
          await setStreamTab(String(message.config?.roomId || ""), tabId);
          if (message.config?.role === "host") {
            await setController({ tabId, frameId: null, returnFocus: true, fullscreenApplied: false });
          }
        }
        sendResponse({ ok: true, url: roomState.data.url });
        return;
      }
      sendResponse({ ok: false, error: "Unknown SyncWatch extension action." });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "SyncWatch request failed." });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getController().then((activeController) => {
    if (activeController?.tabId === tabId) return setController(null);
  });
  getStreamTabs().then(async (streamTabs) => {
    const nextTabs = Object.fromEntries(Object.entries(streamTabs).filter(([, value]) => value !== tabId));
    await chrome.storage.session.set({ syncwatchStreamTabs: nextTabs });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.role || changes.roomId || changes.enabled || changes.autoFullscreen)) setController(null);
});
