const { app, BrowserWindow, desktopCapturer, session, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const APP_URL = process.env.SYNCWATCH_URL
  || (app.isPackaged ? "https://syncwatch-tgzg.onrender.com" : "http://localhost:5173");
const PACKAGED_INDEX = path.join(__dirname, "app", "index.html");
const APP_ROOT = path.resolve(__dirname, "app");
const CHROME_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
let localAppServer = null;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function startLocalAppServer() {
  return new Promise((resolve, reject) => {
    localAppServer = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const requestedFile = path.resolve(APP_ROOT, relativePath);
      const safeFile = requestedFile.startsWith(`${APP_ROOT}${path.sep}`) ? requestedFile : PACKAGED_INDEX;
      const file = fs.existsSync(safeFile) && fs.statSync(safeFile).isFile() ? safeFile : PACKAGED_INDEX;
      response.setHeader("Content-Type", MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      fs.createReadStream(file).pipe(response);
    });
    localAppServer.once("error", reject);
    localAppServer.listen(0, "127.0.0.1", () => resolve(localAppServer.address().port));
  });
}

function isTrustedAppUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

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
      webviewTag: true,
      autoplayPolicy: "no-user-gesture-required"
    }
  });

  window.webContents.setUserAgent(CHROME_USER_AGENT);
  window.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.autoplayPolicy = "no-user-gesture-required";
    webPreferences.preload = path.join(__dirname, "guest-preload.cjs");
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

app.userAgentFallback = CHROME_USER_AGENT;

app.whenReady().then(async () => {
  const allowedPermissions = new Set(["media", "display-capture", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedAppUrl(webContents.getURL()) && allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    isTrustedAppUrl(webContents?.getURL()) && allowedPermissions.has(permission)
  ));
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ["window", "screen"] })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: "loopback" } : {}))
      .catch(() => callback({}));
  }, { useSystemPicker: true });
  const window = createWindow();
  if (app.isPackaged) {
    const port = await startLocalAppServer();
    await window.loadURL(`http://127.0.0.1:${port}`);
  } else {
    await window.loadURL(APP_URL);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWindow = createWindow();
      if (app.isPackaged && localAppServer?.listening) {
        nextWindow.loadURL(`http://127.0.0.1:${localAppServer.address().port}`);
      } else {
        nextWindow.loadURL(APP_URL);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => localAppServer?.close());
