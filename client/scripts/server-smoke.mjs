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
guest.emit("room:join", { roomId: created.roomId, username: "Guest" });
await waitFor(guest, "room:state");
const users = await waitFor(host, "room:users");
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

host.disconnect();
guest.disconnect();
console.log(JSON.stringify({ ok: true, roomId: created.roomId, hostSocketId: hostState.hostSocketId }));
