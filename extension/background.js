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

async function setStreamTab(roomId, streamTab) {
  const streamTabs = await getStreamTabs();
  streamTabs[roomId] = streamTab;
  await chrome.storage.session.set({ syncwatchStreamTabs: streamTabs });
}

async function getExistingStreamTab(roomId) {
  const streamTabs = await getStreamTabs();
  const stored = streamTabs[roomId];
  const tabId = Number.isInteger(stored) ? stored : stored?.tabId;
  if (!Number.isInteger(tabId)) return null;
  try { return { ...(typeof stored === "object" ? stored : {}), tab: await chrome.tabs.get(tabId) }; }
  catch { return null; }
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
      activeController = { tabId, frameId, returnFocus: false };
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
      await returnFocusToSyncWatch(config, activeController);
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
      if (message?.type === "syncwatch:register-stream-tab") {
        const roomId = String(message.roomId || "");
        const tabId = sender.tab?.id;
        if (!/^\d{6}$/.test(roomId) || !Number.isInteger(tabId)) throw new Error("The stream tab could not be registered.");
        const existing = await getExistingStreamTab(roomId);
        await setStreamTab(roomId, {
          tabId,
          windowId: sender.tab.windowId,
          url: sender.tab.url || existing?.url || "",
          managed: Boolean(existing?.managed)
        });
        if (message.role === "host") {
          const activeController = await getController();
          if (activeController?.tabId !== tabId) {
            await setController({ tabId, frameId: null, returnFocus: Boolean(existing?.managed) });
          }
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "syncwatch:capture-context") {
        const tabId = Number(message.tabId);
        const streamTabs = await getStreamTabs();
        const entry = Object.entries(streamTabs).find(([, value]) => {
          const storedTabId = Number.isInteger(value) ? value : value?.tabId;
          return storedTabId === tabId;
        });
        sendResponse(entry
          ? { ok: true, isStreamTab: true, roomId: entry[0] }
          : { ok: true, isStreamTab: false });
        return;
      }
      if (message?.type === "syncwatch:start-capture") {
        const targetTabId = Number(message.tabId);
        const streamTabs = await getStreamTabs();
        const entry = Object.entries(streamTabs).find(([, value]) => {
          const storedTabId = Number.isInteger(value) ? value : value?.tabId;
          return storedTabId === targetTabId;
        });
        if (!entry) throw new Error("This is not the stream tab for an active SyncWatch room.");
        const roomId = entry[0];
        const storedConfig = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER });
        const serverOrigin = new URL(storedConfig.serverUrl || DEFAULT_SERVER).origin;
        const roomTabs = await chrome.tabs.query({});
        const consumerTab = roomTabs.find((tab) => {
          try { return new URL(tab.url).origin === serverOrigin && new URL(tab.url).pathname === `/room/${roomId}`; }
          catch { return false; }
        });
        if (!Number.isInteger(consumerTab?.id)) throw new Error("Keep the matching SyncWatch room open, then try again.");
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId,
          consumerTabId: consumerTab.id
        });
        await chrome.tabs.sendMessage(consumerTab.id, {
          type: "syncwatch:consume-tab-capture",
          streamId,
          roomId,
          sourceTabId: targetTabId
        });
        await chrome.tabs.update(consumerTab.id, { active: true });
        await chrome.windows.update(consumerTab.windowId, { focused: true });
        sendResponse({ ok: true, roomId });
        return;
      }
      if (message?.type === "syncwatch:auto-stream") {
        const config = message.config || {};
        const roomId = String(config.roomId || "");
        let streamUrl = String(message.url || "");
        if (!/^\d{6}$/.test(roomId)) throw new Error("A valid SyncWatch room is required.");
        if (!streamUrl) {
          const existing = await getExistingStreamTab(roomId);
          if (existing?.managed && Number.isInteger(existing.windowId)) await chrome.windows.remove(existing.windowId).catch(() => {});
          sendResponse({ ok: true, closed: Boolean(existing?.managed) });
          return;
        }
        const parsed = new URL(streamUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("The stream link is invalid.");
        streamUrl = parsed.toString();
        const existing = await getExistingStreamTab(roomId);
        if (existing?.tab) {
          if (existing.tab.url !== streamUrl) await chrome.tabs.update(existing.tab.id, { url: streamUrl });
          await setStreamTab(roomId, { tabId: existing.tab.id, windowId: existing.tab.windowId, url: streamUrl, managed: Boolean(existing.managed) });
          if (config.role === "host") await setController({ tabId: existing.tab.id, frameId: null, returnFocus: false });
          sendResponse({ ok: true, reused: true, url: streamUrl });
          return;
        }
        const created = await chrome.windows.create({
          url: streamUrl,
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
          await setStreamTab(roomId, { tabId, windowId: created.id, url: streamUrl, managed: true });
          if (config.role === "host") await setController({ tabId, frameId: null, returnFocus: true });
        }
        sendResponse({ ok: true, url: streamUrl });
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
    const nextTabs = Object.fromEntries(Object.entries(streamTabs).filter(([, value]) => {
      const storedTabId = Number.isInteger(value) ? value : value?.tabId;
      return storedTabId !== tabId;
    }));
    await chrome.storage.session.set({ syncwatchStreamTabs: nextTabs });
  });
});
