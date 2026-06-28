const { contextBridge } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

contextBridge.exposeInMainWorld("syncwatchDesktop", {
  isDesktop: true,
  guestPreloadUrl: pathToFileURL(path.join(__dirname, "guest-preload.cjs")).href
});
