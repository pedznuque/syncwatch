import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FastForward, Maximize2, Pause, Play, Rewind } from "lucide-react";
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
  const captureVideoRef = useRef(null);
  const captureContainerRef = useRef(null);
  const captureStreamRef = useRef(null);
  const [captureActive, setCaptureActive] = useState(false);
  const [captureStatus, setCaptureStatus] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  useEffect(() => {
    const stopCapture = () => {
      const stream = captureStreamRef.current;
      captureStreamRef.current = null;
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      if (captureVideoRef.current) captureVideoRef.current.srcObject = null;
      setCaptureActive(false);
    };
    const onCapture = async (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== "syncwatch:tab-capture" || event.data.roomId !== roomId) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: event.data.streamId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: event.data.streamId,
              maxWidth: 3840,
              maxHeight: 2160,
              maxFrameRate: 60
            }
          }
        });
        stopCapture();
        captureStreamRef.current = stream;
        stream.getVideoTracks().forEach((track) => { track.contentHint = "detail"; track.onended = stopCapture; });
        stream.getAudioTracks().forEach((track) => { track.contentHint = "music"; track.onended = stopCapture; });
        if (captureVideoRef.current) {
          captureVideoRef.current.srcObject = stream;
          captureVideoRef.current.muted = false;
          captureVideoRef.current.volume = 1;
        }
        const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
        const resolution = settings.width && settings.height ? `${settings.width}x${settings.height}` : "source quality";
        setCaptureActive(true);
        const started = await captureVideoRef.current?.play().then(() => true).catch(() => false);
        setCaptureStatus(started
          ? `Playing locally in SyncWatch (${resolution})`
          : `Capture connected at ${resolution}. Click the player once to enable playback.`);
      } catch (error) {
        setCaptureStatus(error?.message || "Chrome could not connect the captured tab.");
      }
    };
    window.addEventListener("message", onCapture);
    return () => {
      window.removeEventListener("message", onCapture);
      stopCapture();
    };
  }, [roomId]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === captureContainerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!captureContainerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await captureContainerRef.current.requestFullscreen();
  };

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
        The extension automatically opens or updates one stream window. In that window, click the SyncWatch extension once and choose <strong>Show this video in SyncWatch</strong>.
      </p>

      <div ref={captureContainerRef} className={isFullscreen ? "web-capture-frame fullscreen" : "web-capture-frame"} hidden={!captureActive}>
        <video ref={captureVideoRef} autoPlay playsInline onClick={() => captureVideoRef.current?.play().catch(() => {})} />
        <button className="web-capture-fullscreen" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          <Maximize2 size={18} />
        </button>
        {isFullscreen && <FullscreenChatOverlay roomId={roomId} username={username} voice={voice} />}
      </div>
      {captureStatus && <p className="web-capture-status">{captureStatus}</p>}

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
