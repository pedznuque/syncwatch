import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../../extension/background.js", import.meta.url), "utf8");
const session = {};
const tabs = new Map();
const calls = { created: [], updated: [], removed: [] };
let messageListener;

const chrome = {
  runtime: {
    id: "smoke-extension",
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  storage: {
    session: {
      async get(key) { return { [key]: session[key] }; },
      async set(values) { Object.assign(session, values); },
      async remove(key) { delete session[key]; }
    }
  },
  tabs: {
    async get(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("Missing tab");
      return { ...tab };
    },
    async update(tabId, changes) {
      const tab = { ...tabs.get(tabId), ...changes };
      tabs.set(tabId, tab);
      calls.updated.push({ tabId, changes });
      return tab;
    },
    async query() { return []; },
    onRemoved: { addListener() {} }
  },
  windows: {
    async create(options) {
      const tab = { id: 501, windowId: 77, url: options.url };
      tabs.set(tab.id, tab);
      calls.created.push(options);
      return { id: 77, tabs: [tab] };
    },
    async remove(windowId) { calls.removed.push(windowId); tabs.delete(501); },
    async update() {}
  }
};

vm.runInNewContext(source, { chrome, fetch, URL, console, setTimeout, clearTimeout });
if (!messageListener) throw new Error("Background message listener was not registered");

const send = (message, sender = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out: ${message.type}`)), 2000);
  messageListener(message, sender, (response) => {
    clearTimeout(timer);
    resolve(response);
  });
});

const config = { roomId: "123456", role: "viewer", serverUrl: "https://syncwatch-tgzg.onrender.com" };
const opened = await send({ type: "syncwatch:auto-stream", config, url: "https://example.com/first" });
if (!opened.ok || calls.created.length !== 1 || calls.created[0].url !== "https://example.com/first") {
  throw new Error("Automatic stream window did not open");
}

const reused = await send({ type: "syncwatch:auto-stream", config, url: "https://example.com/second" });
if (!reused.ok || !reused.reused || calls.updated.at(-1)?.changes.url !== "https://example.com/second") {
  throw new Error("Automatic stream window did not follow a changed link");
}

const registered = await send(
  { type: "syncwatch:register-stream-tab", roomId: "123456", role: "host" },
  { tab: { id: 501, windowId: 77, url: "https://example.com/second" }, frameId: 0 }
);
if (!registered.ok || session.syncwatchController?.tabId !== 501) {
  throw new Error("Host video tab did not become the automatic controller");
}

const closed = await send({ type: "syncwatch:auto-stream", config, url: "" });
if (!closed.ok || !closed.closed || calls.removed[0] !== 77) {
  throw new Error("Managed stream window did not close when web media was cleared");
}

console.log(JSON.stringify({ ok: true, opened: calls.created.length, navigated: calls.updated.length, controller: 501 }));
