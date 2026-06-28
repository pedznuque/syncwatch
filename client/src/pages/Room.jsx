import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { socket } from "../utils/socket.js";
import MediaPanel from "../components/MediaPanel.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import InvitePanel from "../components/InvitePanel.jsx";

function saveRoomHistory(roomId, username) {
  const key = "syncwatch_room_history";
  const history = JSON.parse(localStorage.getItem(key) || "[]");
  const next = [
    { roomId, username, lastVisited: new Date().toISOString() },
    ...history.filter((item) => item.roomId !== roomId)
  ].slice(0, 8);
  localStorage.setItem(key, JSON.stringify(next));
}

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const username = useMemo(() => localStorage.getItem("syncwatch_username") || "Guest", []);
  const [roomState, setRoomState] = useState(null);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(socket.connected);
  const [screenShare, setScreenShare] = useState(null);

  useEffect(() => saveRoomHistory(roomId, username), [roomId, username]);

  useEffect(() => {
    const join = () => {
      setConnected(true);
      socket.emit("room:join", { roomId, username });
    };

    const onDisconnect = () => setConnected(false);
    const onRoomError = ({ message }) => {
      alert(message || "Room does not exist.");
      navigate("/");
    };
    const onState = (state) => {
      setRoomState(state);
      setUsers(state.users || []);
      setScreenShare(state.screenShare || null);
    };
    const onUsers = (nextUsers) => setUsers(nextUsers || []);
    const onHost = (hostSocketId) => setRoomState((current) => current ? { ...current, hostSocketId } : current);
    const onScreenStarted = (share) => {
      setScreenShare(share);
    };
    const onScreenStopped = () => {
      setScreenShare(null);
    };

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("room:error", onRoomError);
    socket.on("room:users", onUsers);
    socket.on("room:host", onHost);
    socket.on("screen:started", onScreenStarted);
    socket.on("screen:stopped", onScreenStopped);

    if (socket.connected) join();

    return () => {
      socket.emit("room:leave", { roomId });
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("room:error", onRoomError);
      socket.off("room:users", onUsers);
      socket.off("room:host", onHost);
      socket.off("screen:started", onScreenStarted);
      socket.off("screen:stopped", onScreenStopped);
    };
  }, [navigate, roomId, username]);

  const isHost = roomState?.hostSocketId === socket.id;
  const canControl = isHost || Boolean(users.find((user) => user.socketId === socket.id)?.isController);

  const leaveRoom = () => {
    socket.emit("room:leave", { roomId });
    navigate("/");
  };

  return (
    <main className="room-page">
      <header className="topbar glassbar">
        <div>
          <Link to="/" className="brand">SyncWatch</Link>
          <span className={connected ? "status online" : "status offline"}>{connected ? "Online" : "Offline"}</span>
        </div>
        <div className="top-actions">
          <p>Signed in as <strong>{username}</strong></p>
          <button className="ghost danger-text" onClick={leaveRoom}>Leave room</button>
        </div>
      </header>

      <div className="watch-shell">
        <section className="watch-main">
          <MediaPanel
            roomId={roomId}
            state={roomState}
            screenShare={screenShare}
            username={username}
            isHost={canControl}
          />
          <div className="below-player-grid streamlined-bottom">
            <InvitePanel roomId={roomId} users={users} onLeave={leaveRoom} isHost={isHost} hostSocketId={roomState?.hostSocketId} />
          </div>
        </section>

        <aside className="chat-dock">
          <ChatPanel roomId={roomId} username={username} initialMessages={roomState?.messages || []} users={users} />
        </aside>
      </div>
    </main>
  );
}
