import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FastForward, MonitorPlay, Pause, Play, Rewind, SquareArrowOutUpRight } from "lucide-react";
import { SERVER_URL } from "../utils/socket.js";
import DesktopWebPlayer from "./DesktopWebPlayer.jsx";

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export default function WebStreamPanel({ roomId, webUrl, webState, isHost, isDesktop }) {
  const [showPreview, setShowPreview] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [seeking, setSeeking] = useState(false);
  const [seekDraft, setSeekDraft] = useState(Number(webState?.currentTime || 0));
  const [commandStatus, setCommandStatus] = useState("");
  const serverOrigin = SERVER_URL.replace(/\/+$/, "");
  const hasLink = Boolean(webUrl);
  const detected = Boolean(webState?.playerDetected)
    && now - Number(webState?.updatedAt || 0) < 10_000;
  const isPlaying = detected && !webState?.paused;
  const duration = Number(webState?.duration || 0);
  const liveTime = useMemo(() => {
    const elapsed = isPlaying ? Math.max(0, (now - Number(webState?.updatedAt || now)) / 1000) : 0;
    return Math.min(duration || Number.MAX_SAFE_INTEGER, Number(webState?.currentTime || 0) + elapsed * Number(webState?.playbackRate || 1));
  }, [duration, isPlaying, now, webState]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!seeking) setSeekDraft(liveTime);
  }, [liveTime, seeking]);

  const sendCommand = async (eventType, overrides = {}) => {
    if (!isHost || !hasLink) return;
    setCommandStatus("Sending command...");
    try {
      const response = await fetch(`${serverOrigin}/rooms/${roomId}/web-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webUrl,
          title: webState?.title || "Web stream",
          currentTime: liveTime,
          duration,
          paused: webState?.paused ?? true,
          playbackRate: Number(webState?.playbackRate || 1),
          sourceId: "syncwatch-app",
          eventType,
          ...overrides
        })
      });
      if (!response.ok) throw new Error("Command was rejected");
      setCommandStatus(eventType === "play" ? "Play sent" : eventType === "pause" ? "Pause sent" : "Seek sent");
    } catch {
      setCommandStatus("Could not reach the controlled player");
    }
  };

  const openStream = () => {
    if (!hasLink) return;
    const popup = window.open(webUrl, `syncwatch-stream-${roomId}`, "popup=yes,width=1280,height=800,resizable=yes,scrollbars=yes");
    if (popup) {
      try { popup.opener = null; } catch {}
      popup.focus();
    } else alert("Allow pop-ups for SyncWatch to open the stream window.");
  };

  const status = !hasLink
    ? { tone: "idle", label: "No stream link set", detail: "Paste a streaming page URL above." }
    : detected
      ? { tone: "online", label: "Video detected", detail: `${webState?.title || "HTML5 video"} - ${isPlaying ? "playing" : "paused"}` }
      : { tone: "waiting", label: "Link set - waiting for video", detail: "Open the stream with the extension enabled." };

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
        <button disabled={!hasLink} onClick={openStream}><ExternalLink size={17} /> Open stream window</button>
        <button disabled={!hasLink} onClick={() => setShowPreview((value) => !value)}>
          {showPreview ? <SquareArrowOutUpRight size={17} /> : <MonitorPlay size={17} />}
          {showPreview ? "Hide from SyncWatch" : "Render in SyncWatch"}
        </button>
      </div>

      <p className="web-stream-help">
        The extension controls the separate stream window. Rendering inside SyncWatch is also available, but providers that block embedding must stay in the stream window.
      </p>

      {hasLink && isHost && (
        <div className="web-remote-controls">
          <button onClick={() => sendCommand("seek", { currentTime: Math.max(0, liveTime - 10) })} title="Back 10 seconds"><Rewind size={18} /></button>
          <button className="main-play-control" onClick={() => sendCommand(isPlaying ? "pause" : "play", { paused: isPlaying })}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => sendCommand("seek", { currentTime: Math.min(duration || Number.MAX_SAFE_INTEGER, liveTime + 10) })} title="Forward 10 seconds"><FastForward size={18} /></button>
          <span>{formatTime(seeking ? seekDraft : liveTime)} / {formatTime(duration)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 1)}
            step="0.1"
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

      {showPreview && hasLink && (
        isDesktop ? (
          <DesktopWebPlayer roomId={roomId} url={webUrl} canControl={isHost} initialTime={webState?.currentTime} initialPlaying={!webState?.paused} />
        ) : (
          <div className="web-preview-frame">
            <iframe
              key={webUrl}
              src={webUrl}
              title="Synchronized web stream"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
              allowFullScreen
            />
            <p>If the provider blocks embedding, use <strong>Open stream window</strong>. The extension will still control it.</p>
          </div>
        )
      )}
    </div>
  );
}
