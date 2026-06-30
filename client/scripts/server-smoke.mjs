import { io } from "socket.io-client";

const baseUrl = process.env.SYNCWATCH_TEST_URL || "http://127.0.0.1:5000";
const waitFor = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
  const listener = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    socket.off(event, listener);
    resolve(payload);
  };
  socket.on(event, listener);
});

const iceResponse = await fetch(`${baseUrl}/ice-config`);
if (!iceResponse.ok) throw new Error("ICE configuration failed");
const iceConfig = await iceResponse.json();
if (!iceConfig.iceServers?.some((server) => {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some((url) => String(url).startsWith("turn:") || String(url).startsWith("turns:"));
})) throw new Error("TURN relay is missing from ICE configuration");

const extensionResponse = await fetch(`${baseUrl}/downloads/syncwatch-web-player.zip`);
const extensionBytes = new Uint8Array(await extensionResponse.arrayBuffer());
if (!extensionResponse.ok
  || !extensionResponse.headers.get("content-disposition")?.includes("syncwatch-web-player.zip")
  || extensionBytes[0] !== 0x50 || extensionBytes[1] !== 0x4b) {
  throw new Error("Extension download package is invalid");
}

const createdResponse = await fetch(`${baseUrl}/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ownerName: "Host" })
});
if (!createdResponse.ok) throw new Error("Room creation failed");
const created = await createdResponse.json();
if (!/^\d{6}$/.test(created.roomId)) throw new Error(`Room code is not six digits: ${created.roomId}`);

const existingResponse = await fetch(`${baseUrl}/rooms/${created.roomId}`);
if (!existingResponse.ok) throw new Error("Existing room validation failed");
const missingResponse = await fetch(`${baseUrl}/rooms/999999`);
if (missingResponse.status !== 404 && created.roomId !== "999999") throw new Error("Missing room validation failed");

const host = io(baseUrl, { transports: ["websocket"] });
const guest = io(baseUrl, { transports: ["websocket"] });
await Promise.all([waitFor(host, "connect"), waitFor(guest, "connect")]);

host.emit("room:join", { roomId: created.roomId, username: "Host" });
const hostState = await waitFor(host, "room:state");
const usersReceived = waitFor(host, "room:users", (nextUsers) => nextUsers.some((user) => user.username === "Guest"));
guest.emit("room:join", { roomId: created.roomId, username: "Guest" });
await waitFor(guest, "room:state");
const users = await usersReceived;
const guestUser = users.find((user) => user.username === "Guest");
if (!guestUser) throw new Error("Guest did not join");

host.emit("room:set-controller", { roomId: created.roomId, targetSocketId: guestUser.socketId, enabled: true });
const promotedUsers = await waitFor(guest, "room:users", (nextUsers) =>
  nextUsers.find((user) => user.socketId === guestUser.socketId)?.isController
);
if (!promotedUsers.find((user) => user.socketId === guestUser.socketId)?.isController) throw new Error("Moderator promotion failed");

const mediaReceived = waitFor(host, "room:media");
guest.emit("room:set-media", {
  roomId: created.roomId,
  mode: "web",
  externalUrl: "https://www.bilibili.tv/",
  videoUrl: "",
  youtubeId: ""
});
const media = await mediaReceived;
if (media.externalUrl !== "https://www.bilibili.tv/") throw new Error("Moderator media control failed");

const webSyncResponse = await fetch(`${baseUrl}/rooms/${created.roomId}/web-sync`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
  },
  body: JSON.stringify({
    url: "https://www.bilibili.tv/",
    title: "Extension test",
    currentTime: 42,
    paused: false,
    playbackRate: 1,
    sourceId: "extension-host:smoke-test",
    eventType: "progress",
    playerDetected: true
  })
});
const webSync = await webSyncResponse.json();
if (webSyncResponse.headers.get("access-control-allow-origin") !== "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
  || !webSyncResponse.ok || webSync.currentTime !== 42 || !webSync.playerDetected) {
  throw new Error("Extension web-sync endpoint failed");
}

const hostVoicePeers = waitFor(host, "voice:peers");
host.emit("voice:join", { roomId: created.roomId });
if ((await hostVoicePeers).socketIds.length !== 0) throw new Error("Unexpected host voice peers");
const guestVoicePeers = waitFor(guest, "voice:peers");
const guestJoinedVoice = waitFor(host, "voice:user-joined", (event) => event.socketId === guest.id);
guest.emit("voice:join", { roomId: created.roomId });
const [voicePeers] = await Promise.all([guestVoicePeers, guestJoinedVoice]);
if (!voicePeers.socketIds.includes(host.id)) throw new Error("Voice presence discovery failed");

const relayedOffer = waitFor(guest, "voice:offer");
host.emit("voice:offer", {
  roomId: created.roomId,
  targetSocketId: guest.id,
  offer: { type: "offer", sdp: "smoke-test" }
});
if ((await relayedOffer).roomId !== created.roomId) throw new Error("Voice signaling relay failed");

const guestLeftVoice = waitFor(host, "voice:user-left", (event) => event.socketId === guest.id);
guest.emit("voice:leave", { roomId: created.roomId });
await guestLeftVoice;

host.disconnect();
guest.disconnect();
console.log(JSON.stringify({ ok: true, roomId: created.roomId, hostSocketId: hostState.hostSocketId }));
