import express from "express";
import http from "http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { randomInt } from "node:crypto";
import { streamExtractor } from "./streamExtractor.js";

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const allowedOrigins = new Set(
  [CLIENT_ORIGIN, process.env.RENDER_EXTERNAL_URL, "https://syncwatch-tgzg.onrender.com", "http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"]
    .filter(Boolean)
    .map((value) => {
      try { return new URL(value).origin; } catch { return value.replace(/\/$/, ""); }
    })
);
const allowOrigin = (origin, callback) => {
  let normalizedOrigin = origin;
  try { normalizedOrigin = origin ? new URL(origin).origin : origin; } catch {}
  const allowed = !origin || allowedOrigins.has(normalizedOrigin);
  callback(allowed ? null : new Error("Origin not allowed"), allowed);
};

const app = express();
app.use(cors({ origin: allowOrigin }));
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowOrigin,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e7
});

const rooms = new Map();

function createRoom(ownerName = "Host", requestedRoomId = "") {
  let roomId = /^\d{6}$/.test(requestedRoomId) ? requestedRoomId : "";
  while (!roomId || rooms.has(roomId)) roomId = String(randomInt(100000, 1000000));
  rooms.set(roomId, {
    roomId,
    hostSocketId: null,
    ownerName,
    users: [],
    videoUrl: "",
    externalUrl: "",
    mode: "web",
    youtubeId: "",
    webSync: {
      seq: 0,
      url: "",
      title: "",
      currentTime: 0,
      duration: 0,
      paused: true,
      playbackRate: 1,
      sourceId: "",
      updatedAt: 0
    },
    screenShare: null,
    isPlaying: false,
    currentTime: 0,
    messages: []
  });
  return rooms.get(roomId);
}

function publicRoom(room) {
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    users: room.users,
    videoUrl: room.videoUrl,
    externalUrl: room.externalUrl,
    youtubeId: room.youtubeId,
    webSync: room.webSync,
    screenShare: room.screenShare,
    mode: room.mode,
    isPlaying: room.isPlaying,
    currentTime: room.currentTime,
    messages: room.messages.slice(-50)
  };
}

function addSystemMessage(room, text) {
  const message = {
    id: nanoid(10),
    username: "SyncWatch",
    text,
    image: null,
    system: true,
    createdAt: new Date().toISOString()
  };
  room.messages.push(message);
  room.messages = room.messages.slice(-100);
  return message;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/ice-config", (_req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(",").map((url) => url.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers });
});

app.post("/rooms", (req, res) => {
  const ownerName = req.body?.ownerName || "Host";
  const room = createRoom(ownerName);
  res.status(201).json(publicRoom(room));
});

app.get("/rooms/:roomId", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(publicRoom(room));
});

const canControlRoom = (room, socketId) => room.hostSocketId === socketId
  || room.users.some((user) => user.socketId === socketId && user.isController);

app.get("/rooms/:roomId/web-sync", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room.webSync);
});

app.post("/rooms/:roomId/web-sync", (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });

  let url = String(req.body?.url || room.webSync.url || "").slice(0, 2048);
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
    url = parsed.toString();
  } catch {
    return res.status(400).json({ error: "A valid video page URL is required" });
  }

  const number = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, max)) : fallback;
  };

  room.webSync = {
    seq: room.webSync.seq + 1,
    url,
    title: String(req.body?.title || room.webSync.title || "Web video").slice(0, 200),
    currentTime: number(req.body?.currentTime, room.webSync.currentTime, 60 * 60 * 24),
    duration: number(req.body?.duration, room.webSync.duration, 60 * 60 * 24),
    paused: typeof req.body?.paused === "boolean" ? req.body.paused : room.webSync.paused,
    playbackRate: number(req.body?.playbackRate, room.webSync.playbackRate, 4) || 1,
    sourceId: String(req.body?.sourceId || "web").slice(0, 100),
    updatedAt: Date.now()
  };

  io.to(req.params.roomId).emit("web:state", room.webSync);
  res.json(room.webSync);
});

app.post("/extract-stream", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const metadata = await streamExtractor.extractStream(url);
    res.json(metadata);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, username }) => {
    const normalizedRoomId = String(roomId || "");
    const room = /^\d{6}$/.test(normalizedRoomId) ? rooms.get(normalizedRoomId) : null;
    if (!room) return socket.emit("room:error", { message: "Room does not exist or has expired." });

    socket.join(roomId);

    if (!room.hostSocketId) {
      room.hostSocketId = socket.id;
    }

    const existing = room.users.find((user) => user.socketId === socket.id);
    if (!existing) {
      const joinedUser = {
        socketId: socket.id,
        username: username || `Guest-${socket.id.slice(0, 4)}`,
        isController: false,
        joinedAt: new Date().toISOString()
      };
      room.users.push(joinedUser);
      const message = addSystemMessage(room, `${joinedUser.username} joined the room`);
      socket.emit("room:state", publicRoom(room));
      socket.to(roomId).emit("chat:message", message);
    } else {
      socket.emit("room:state", publicRoom(room));
    }

    io.to(roomId).emit("room:users", room.users);
  });

  socket.on("room:set-media", ({ roomId, mode, videoUrl, externalUrl, youtubeId }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;

    room.mode = ["direct-video", "youtube", "web"].includes(mode) ? mode : "direct-video";
    room.videoUrl = videoUrl || "";
    room.externalUrl = externalUrl || "";
    room.youtubeId = youtubeId || "";
    if (room.mode === "web" && room.externalUrl) {
      room.webSync = {
        ...room.webSync,
        seq: room.webSync.seq + 1,
        url: room.externalUrl,
        title: "Supported web media ready",
        sourceId: "app",
        updatedAt: Date.now()
      };
      io.to(roomId).emit("web:state", room.webSync);
    }
    room.isPlaying = false;
    room.currentTime = 0;

    io.to(roomId).emit("room:media", {
      mode: room.mode,
      videoUrl: room.videoUrl,
      externalUrl: room.externalUrl,
      youtubeId: room.youtubeId
    });
  });

  socket.on("player:play", ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;
    room.isPlaying = true;
    room.currentTime = Number(currentTime || 0);
    socket.to(roomId).emit("player:play", room.currentTime);
  });

  socket.on("player:pause", ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;
    room.isPlaying = false;
    room.currentTime = Number(currentTime || 0);
    socket.to(roomId).emit("player:pause", room.currentTime);
  });

  socket.on("player:seek", ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;
    room.currentTime = Number(currentTime || 0);
    socket.to(roomId).emit("player:seek", room.currentTime);
  });

  // Low-frequency host heartbeat corrects long-session drift without causing
  // constant seeks or unnecessary network traffic.
  socket.on("player:sync", ({ roomId, currentTime, isPlaying }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;
    room.currentTime = Number(currentTime || 0);
    room.isPlaying = Boolean(isPlaying);
    socket.to(roomId).emit("player:sync", {
      currentTime: room.currentTime,
      isPlaying: room.isPlaying
    });
  });

  socket.on("room:set-controller", ({ roomId, targetSocketId, enabled }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostSocketId !== socket.id || targetSocketId === socket.id) return;
    const target = room.users.find((user) => user.socketId === targetSocketId);
    if (!target) return;
    target.isController = Boolean(enabled);
    io.to(roomId).emit("room:users", room.users);
    const message = addSystemMessage(room, `${target.username} ${target.isController ? "can now control playback" : "is now a viewer"}`);
    io.to(roomId).emit("chat:message", message);
  });

  socket.on("chat:message", ({ roomId, username, text, image }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const sender = room.users.find((user) => user.socketId === socket.id);
    const message = {
      id: nanoid(10),
      username: sender?.username || username || "Guest",
      senderSocketId: socket.id,
      text: String(text || "").slice(0, 1000),
      image: image || null,
      createdAt: new Date().toISOString()
    };

    room.messages.push(message);
    room.messages = room.messages.slice(-100);
    io.to(roomId).emit("chat:message", message);
  });


  socket.on("external:cue", ({ roomId, action, timeLabel }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.find((item) => item.socketId === socket.id);
    const cue = {
      username: user?.username || "Host",
      action: String(action || "Sync now").slice(0, 60),
      timeLabel: String(timeLabel || "0:00").slice(0, 20)
    };
    const message = {
      id: nanoid(10),
      username: "SyncWatch",
      text: `${cue.username} says: ${cue.action} at ${cue.timeLabel}`,
      image: null,
      system: true,
      createdAt: new Date().toISOString()
    };
    room.messages.push(message);
    room.messages = room.messages.slice(-100);
    io.to(roomId).emit("external:cue", cue);
    io.to(roomId).emit("chat:message", message);
  });

  socket.on("room:leave", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.screenShare?.userId === socket.id) {
      room.screenShare = null;
      io.to(roomId).emit("screen:stopped", { userId: socket.id, username: "Guest" });
    }
    const leavingUser = room.users.find((user) => user.socketId === socket.id);
    room.users = room.users.filter((user) => user.socketId !== socket.id);
    socket.leave(roomId);
    if (room.hostSocketId === socket.id) room.hostSocketId = room.users[0]?.socketId || null;
    io.to(roomId).emit("room:users", room.users);
    io.to(roomId).emit("room:host", room.hostSocketId);
    io.to(roomId).emit("voice:user-left", { socketId: socket.id });
    if (leavingUser) {
      const message = addSystemMessage(room, `${leavingUser.username} left the room`);
      io.to(roomId).emit("chat:message", message);
    }
  });

  // WebRTC signaling for voice chat. Actual audio is peer-to-peer in browser.
  socket.on("voice:offer", ({ roomId, targetSocketId, offer }) => {
    io.to(targetSocketId).emit("voice:offer", {
      fromSocketId: socket.id,
      offer
    });
  });

  socket.on("voice:answer", ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit("voice:answer", {
      fromSocketId: socket.id,
      answer
    });
  });

  socket.on("voice:ice-candidate", ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit("voice:ice-candidate", {
      fromSocketId: socket.id,
      candidate
    });
  });

  // WebRTC signaling for screen sharing
  socket.on("screen:start", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !canControlRoom(room, socket.id)) return;
    const user = room.users.find((item) => item.socketId === socket.id);
    room.screenShare = {
      userId: socket.id,
      username: user?.username || "Guest",
      startedAt: Date.now()
    };
    io.to(roomId).emit("screen:started", room.screenShare);
  });

  socket.on("screen:stop", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.screenShare?.userId !== socket.id) return;
    const user = room.users.find((item) => item.socketId === socket.id);
    room.screenShare = null;
    io.to(roomId).emit("screen:stopped", {
      userId: socket.id,
      username: user?.username || "Guest"
    });
  });

  socket.on("screen:request", ({ roomId, sharerSocketId }) => {
    const room = rooms.get(roomId);
    if (!room || room.screenShare?.userId !== sharerSocketId || sharerSocketId === socket.id) return;
    io.to(sharerSocketId).emit("screen:request", {
      fromSocketId: socket.id
    });
  });

  socket.on("screen:offer", ({ roomId, targetSocketId, offer }) => {
    if (!rooms.get(roomId)?.users.some((user) => user.socketId === targetSocketId)) return;
    io.to(targetSocketId).emit("screen:offer", { fromSocketId: socket.id, offer });
  });

  socket.on("screen:answer", ({ roomId, targetSocketId, answer }) => {
    if (!rooms.get(roomId)?.users.some((user) => user.socketId === targetSocketId)) return;
    io.to(targetSocketId).emit("screen:answer", { fromSocketId: socket.id, answer });
  });

  socket.on("screen:ice-candidate", ({ roomId, targetSocketId, candidate }) => {
    if (!rooms.get(roomId)?.users.some((user) => user.socketId === targetSocketId)) return;
    io.to(targetSocketId).emit("screen:ice-candidate", { fromSocketId: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms.entries()) {
      const before = room.users.length;
      const leavingUser = room.users.find((user) => user.socketId === socket.id);
      room.users = room.users.filter((user) => user.socketId !== socket.id);

      if (room.hostSocketId === socket.id) {
        room.hostSocketId = room.users[0]?.socketId || null;
      }

      if (room.screenShare?.userId === socket.id) {
        room.screenShare = null;
        io.to(roomId).emit("screen:stopped", { userId: socket.id, username: "Guest" });
      }

      if (before !== room.users.length) {
        const message = addSystemMessage(room, `${leavingUser?.username || "A friend"} left the room`);
        io.to(roomId).emit("chat:message", message);
        io.to(roomId).emit("room:users", room.users);
        io.to(roomId).emit("room:host", room.hostSocketId);
        io.to(roomId).emit("voice:user-left", { socketId: socket.id });
      }

      if (room.users.length === 0) {
        // Keep room alive briefly for reconnects, then remove.
        setTimeout(() => {
          const latest = rooms.get(roomId);
          if (latest && latest.users.length === 0) rooms.delete(roomId);
        }, 5 * 60 * 1000);
      }
    }
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method === "GET" && req.accepts("html")) {
      return res.sendFile(path.join(CLIENT_DIST, "index.html"));
    }
    next();
  });
}

// Nodemon watches this entry point during local development.
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
