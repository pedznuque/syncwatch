const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const APP_URL = process.env.SYNCWATCH_URL
  || (app.isPackaged ? "https://syncwatch.onrender.com" : "http://localhost:5173");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: "SyncWatch",
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} SyncWatchDesktop/1.0`);
  window.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.preload = path.join(__dirname, "guest-preload.cjs");
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  window.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
