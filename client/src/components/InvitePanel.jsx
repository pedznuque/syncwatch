import { useState } from "react";
import { Copy, LogOut, Shield, ShieldCheck, UsersRound } from "lucide-react";
import { socket } from "../utils/socket.js";

export default function InvitePanel({ roomId, users, onLeave, isHost, hostSocketId }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}/room/${roomId}`;

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="panel invite-panel compact-panel">
      <div className="panel-header">
        <div>
          <h2>Invitation</h2>
          <p>Room code: <strong>{roomId}</strong></p>
        </div>
        <UsersRound size={22} />
      </div>

      <div className="invite-box">
        <input value={inviteUrl} readOnly />
        <button className="primary" onClick={copyInvite}><Copy size={16} /> {copied ? "Copied" : "Copy"}</button>
        <button className="danger" onClick={onLeave}><LogOut size={16} /> Leave</button>
      </div>

      <h3>People inside</h3>
      <div className="user-list">
        {users.map((user) => (
          <div key={user.socketId} className="user-pill user-role-pill">
            <span>{user.username}{user.socketId === hostSocketId ? " · Host" : user.isController ? " · Mod" : ""}</span>
            {isHost && user.socketId !== hostSocketId && (
              <button
                className={user.isController ? "role-toggle active" : "role-toggle"}
                title={user.isController ? "Remove playback control" : "Allow playback control"}
                onClick={() => socket.emit("room:set-controller", { roomId, targetSocketId: user.socketId, enabled: !user.isController })}
              >
                {user.isController ? <ShieldCheck size={14} /> : <Shield size={14} />}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
