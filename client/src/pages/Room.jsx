import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { socket } from "../utils/socket.js";
import MediaPanel from "../components/MediaPanel.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import InvitePanel from "../components/InvitePanel.jsx";
import ScreenSharePanel from "../components/ScreenSharePanel.jsx";

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
  const [showScreenShare, setShowScreenShare] = useState(false);
  const [screenShare, setScreenShare] = useState(null);

  useEffect(() => saveRoomHistory(roomId, username), [roomId, username]);

  useEffect(() => {
    const join = () => {
      setConnected(true);
      socket.emit("room:join", { roomId, username });
    };

    const onDisconnect = () => setConnected(false);
    const onState = (state) => {
      setRoomState(state);
      setUsers(state.users || []);
      setScreenShare(state.screenShare || null);
      if (state.screenShare) setShowScreenShare(true);
    };
    const onUsers = (nextUsers) => setUsers(nextUsers || []);
    const onHost = (hostSocketId) => setRoomState((current) => current ? { ...current, hostSocketId } : current);
    const onScreenStarted = (share) => {
      setScreenShare(share);
      setShowScreenShare(true);
    };
    const onScreenStopped = () => {
      setScreenShare(null);
      setShowScreenShare(false);
    };

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
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
      socket.off("room:users", onUsers);
      socket.off("room:host", onHost);
      socket.off("screen:started", onScreenStarted);
      socket.off("screen:stopped", onScreenStopped);
    };
  }, [roomId, username]);

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
          <div hidden={showScreenShare}>
              <MediaPanel
                roomId={roomId}
                state={roomState}
                onScreenShare={() => setShowScreenShare(true)}
                username={username}
                isHost={roomState?.hostSocketId === socket.id}
              />
              <div className="below-player-grid streamlined-bottom">
                <InvitePanel roomId={roomId} users={users} onLeave={leaveRoom} />
                <button
                  className="screen-share-entry primary"
                  onClick={() => setShowScreenShare(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 7l-7 5 7 5V7z"></path>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                  {screenShare ? `View ${screenShare.username}'s Screen` : "Start Screen Share"}
                </button>
              </div>
          </div>
          <div hidden={!showScreenShare}>
            <ScreenSharePanel roomId={roomId} shareInfo={screenShare} onBack={() => setShowScreenShare(false)} username={username} />
          </div>
        </section>

        <aside className="chat-dock">
          <ChatPanel roomId={roomId} username={username} initialMessages={roomState?.messages || []} users={users} />
        </aside>
      </div>
    </main>
  );
}
