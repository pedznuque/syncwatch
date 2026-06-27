import { useState } from "react";
import { Copy, LogOut, UsersRound } from "lucide-react";

export default function InvitePanel({ roomId, users, onLeave }) {
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
        {users.map((user) => <div key={user.socketId} className="user-pill">{user.username}</div>)}
      </div>
    </section>
  );
}
