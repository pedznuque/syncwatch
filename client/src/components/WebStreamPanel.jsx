import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FastForward, Maximize2, MonitorUp, Pause, Play, Rewind, Square } from "lucide-react";
import { SERVER_URL } from "../utils/socket.js";
import FullscreenChatOverlay from "./FullscreenChatOverlay.jsx";

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

export default function WebStreamPanel({ roomId, webUrl, webState, isHost, username, voice }) {
  const mirrorVideoRef = useRef(null);
  const mirrorContainerRef = useRef(null);
  const mirrorStreamRef = useRef(null);
  const [mirrorActive, setMirrorActive] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [seeking, setSeeking] = useState(false);
  const [seekDraft, setSeekDraft] = useState(Number(webState?.currentTime || 0));
  const [commandStatus, setCommandStatus] = useState("");
  const serverOrigin = SERVER_URL.replace(/\/+$/, "");
  const hasLink = Boolean(webUrl);
  const detected = Boolean(webState?.playerDetected)
    && now - Number(webState?.playerUpdatedAt || webState?.updatedAt || 0) < 10_000;
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

  const stopMirror = () => {
    const stream = mirrorStreamRef.current;
    mirrorStreamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (mirrorVideoRef.current) mirrorVideoRef.current.srcObject = null;
    setMirrorActive(false);
    setMirrorStatus("Mirror stopped");
  };

  useEffect(() => () => {
    mirrorStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === mirrorContainerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const startMirror = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: true
      });
      stopMirror();
      mirrorStreamRef.current = stream;
      if (mirrorVideoRef.current) mirrorVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((track) => { track.onended = stopMirror; });
      setMirrorActive(true);
      setMirrorStatus("Mirroring the selected stream window locally");
    } catch (error) {
      if (error?.name !== "NotAllowedError") setMirrorStatus("Window mirroring is unavailable in this browser");
    }
  };

  const toggleFullscreen = async () => {
    if (!mirrorContainerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await mirrorContainerRef.current.requestFullscreen();
  };

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
      : { tone: "waiting", label: "Link set - waiting for video", detail: "Open the stream and select its tab as the extension controller." };

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
        {!mirrorActive ? (
          <button disabled={!hasLink} onClick={startMirror}><MonitorUp size={17} /> Mirror stream window</button>
        ) : (
          <button onClick={stopMirror}><Square size={17} /> Stop mirror</button>
        )}
      </div>

      <p className="web-stream-help">
        Open the stream separately, then choose <strong>Mirror stream window</strong> and select that window or tab. This is a local mirror, not an iframe and not a broadcast to other viewers.
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

      <div ref={mirrorContainerRef} className={isFullscreen ? "web-mirror-frame fullscreen" : "web-mirror-frame"} hidden={!mirrorActive}>
        <video ref={mirrorVideoRef} autoPlay playsInline />
        <button className="web-mirror-fullscreen" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          <Maximize2 size={18} />
        </button>
        {isFullscreen && <FullscreenChatOverlay roomId={roomId} username={username} voice={voice} />}
      </div>
      {mirrorStatus && <p className="web-mirror-status">{mirrorStatus}</p>}
    </div>
  );
}
