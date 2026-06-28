import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const SERVER_URL = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.PROD ? window.location.origin : "http://localhost:5000");

export default function App() {
  const navigate = useNavigate();
  const [username, setUsername] = useState(localStorage.getItem("syncwatch_username") || "");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const history = useMemo(() => JSON.parse(localStorage.getItem("syncwatch_room_history") || "[]"), []);

  const saveName = () => {
    const cleanName = username.trim() || "Guest";
    localStorage.setItem("syncwatch_username", cleanName);
    return cleanName;
  };

  const createRoom = async () => {
    setError("");
    const ownerName = saveName();

    try {
      const response = await fetch(`${SERVER_URL}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerName })
      });

      if (!response.ok) throw new Error("Could not create room");
      const room = await response.json();
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const joinRoom = async () => {
    setError("");
    saveName();
    const code = joinCode.trim();
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit room code.");
    try {
      const response = await fetch(`${SERVER_URL}/rooms/${code}`);
      if (response.status === 404) return setError("That room does not exist or has expired.");
      if (!response.ok) throw new Error("Could not validate the room.");
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="landing">
      <section className="hero-card upgraded-hero">
        <p className="eyebrow">SyncWatch MVP</p>
        <h1>Watch together with chat, voice, pictures, invites, and room history.</h1>
        <p className="subtitle">
          Create a room, paste a supported video link, invite friends, and talk while watching. YouTube and legal direct videos can play in-room; protected platforms open through their official sites.
        </p>

        <div className="form-grid">
          <label>
            Your name
            <input value={username} placeholder="Gerald" onChange={(e) => setUsername(e.target.value)} />
          </label>

          <button className="primary hero-button" onClick={createRoom}>Create Room</button>
        </div>

        <div className="join-row">
          <input value={joinCode} inputMode="numeric" maxLength={6} placeholder="Enter 6-digit room code" onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && joinRoom()} />
          <button onClick={joinRoom}>Join</button>
        </div>

        {history.length > 0 && (
          <div className="history-card">
            <h2>Recent rooms</h2>
            <div className="history-list">
              {history.map((item) => (
                <button key={item.roomId} className="history-item" onClick={() => navigate(`/room/${item.roomId}`)}>
                  <strong>{item.roomId}</strong>
                  <span>{new Date(item.lastVisited).toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
