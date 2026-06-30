import { useEffect, useMemo, useState } from "react";
import { Download, FastForward, Pause, Play, Rewind } from "lucide-react";
import { SERVER_URL } from "../utils/socket.js";

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export default function WebStreamPanel({ roomId, webUrl, webState, isHost }) {
  const [now, setNow] = useState(Date.now());
  const [seeking, setSeeking] = useState(false);
  const [seekDraft, setSeekDraft] = useState(Number(webState?.currentTime || 0));
  const [commandStatus, setCommandStatus] = useState("");
  const [pendingCommandId, setPendingCommandId] = useState("");
  const [confirmedState, setConfirmedState] = useState(() => ({
    paused: webState?.paused ?? true,
    currentTime: Number(webState?.currentTime || 0),
    duration: Number(webState?.duration || 0),
    playbackRate: Number(webState?.playbackRate || 1),
    updatedAt: Number(webState?.updatedAt || Date.now())
  }));
  const serverOrigin = SERVER_URL.replace(/\/+$/, "");
  const hasLink = Boolean(webUrl);
  const detected = Boolean(webState?.playerDetected)
    && now - Number(webState?.playerUpdatedAt || webState?.updatedAt || 0) < 10_000;
  const isPlaying = detected && !confirmedState.paused;
  const duration = Number(confirmedState.duration || 0);
  const liveTime = useMemo(() => {
    const elapsed = isPlaying ? Math.max(0, (now - Number(confirmedState.updatedAt || now)) / 1000) : 0;
    return Math.min(duration || Number.MAX_SAFE_INTEGER, Number(confirmedState.currentTime || 0) + elapsed * Number(confirmedState.playbackRate || 1));
  }, [confirmedState, duration, isPlaying, now]);

  useEffect(() => {
    if (!String(webState?.sourceId || "").startsWith("extension-host:")) return;
    setConfirmedState({
      paused: webState.paused ?? true,
      currentTime: Number(webState.currentTime || 0),
      duration: Number(webState.duration || 0),
      playbackRate: Number(webState.playbackRate || 1),
      updatedAt: Number(webState.updatedAt || Date.now())
    });
  }, [webState]);

  useEffect(() => {
    if (!pendingCommandId || webState?.ackCommandId !== pendingCommandId) return;
    setCommandStatus(webState.commandError || "Command applied");
    setPendingCommandId("");
  }, [pendingCommandId, webState]);

  useEffect(() => {
    if (!pendingCommandId) return undefined;
    const timer = setTimeout(() => {
      setPendingCommandId((current) => {
        if (current !== pendingCommandId) return current;
        setCommandStatus("Controller did not confirm the command");
        return "";
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [pendingCommandId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!seeking) setSeekDraft(liveTime);
  }, [liveTime, seeking]);

  const sendCommand = async (eventType, overrides = {}) => {
    if (!isHost || !hasLink) return;
    const commandId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPendingCommandId(commandId);
    setCommandStatus("Waiting for player confirmation...");
    try {
      const response = await fetch(`${serverOrigin}/rooms/${roomId}/web-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webUrl,
          title: webState?.title || "Web stream",
          currentTime: liveTime,
          duration,
          paused: confirmedState.paused,
          playbackRate: Number(confirmedState.playbackRate || 1),
          sourceId: "syncwatch-app",
          commandId,
          eventType,
          ...overrides
        })
      });
      if (!response.ok) throw new Error("Command was rejected");
    } catch {
      setPendingCommandId("");
      setCommandStatus("Could not reach the controlled player");
    }
  };

  const status = !hasLink
    ? { tone: "idle", label: "No stream link set", detail: "Paste a streaming page URL above." }
    : detected
      ? { tone: "online", label: "Video detected", detail: `${webState?.title || "HTML5 video"} - ${isPlaying ? "playing" : "paused"}` }
      : { tone: "waiting", label: "Opening stream automatically", detail: "The extension is opening this link and looking for its video player." };

  return (
    <div className="web-stream-workspace">
      <div className={`web-stream-status ${status.tone}`}>
        <span className="web-status-dot" />
        <div><strong>{status.label}</strong><span>{status.detail}</span></div>
      </div>

      <div className="web-stream-actions">
        <a className="button-link" href={`${serverOrigin}/downloads/syncwatch-web-player.zip`} download>
          <Download size={17} /> Download extension
        </a>
      </div>

      <p className="web-stream-help">
        The extension automatically opens or updates one stream window for this room. The host browser controls its detected video; everyone else follows as a viewer.
      </p>

      {hasLink && isHost && (
        <div className="web-remote-controls">
          <button disabled={Boolean(pendingCommandId)} onClick={() => sendCommand("seek", { currentTime: Math.max(0, liveTime - 10) })} title="Back 10 seconds"><Rewind size={18} /></button>
          <button disabled={Boolean(pendingCommandId)} className="main-play-control" onClick={() => sendCommand(isPlaying ? "pause" : "play", { paused: isPlaying })}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button disabled={Boolean(pendingCommandId)} onClick={() => sendCommand("seek", { currentTime: Math.min(duration || Number.MAX_SAFE_INTEGER, liveTime + 10) })} title="Forward 10 seconds"><FastForward size={18} /></button>
          <span>{formatTime(seeking ? seekDraft : liveTime)} / {formatTime(duration)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 1)}
            step="0.1"
            disabled={Boolean(pendingCommandId)}
            value={Math.min(seekDraft, Math.max(duration, 1))}
            onPointerDown={() => setSeeking(true)}
            onChange={(event) => setSeekDraft(Number(event.target.value))}
            onPointerUp={() => {
              setSeeking(false);
              sendCommand("seek", { currentTime: seekDraft });
            }}
            onKeyUp={() => sendCommand("seek", { currentTime: seekDraft })}
            aria-label="Web stream progress"
          />
          {commandStatus && <small>{commandStatus}</small>}
        </div>
      )}
    </div>
  );
}
