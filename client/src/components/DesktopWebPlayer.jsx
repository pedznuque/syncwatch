import { useEffect, useRef, useState } from "react";
import { ExternalLink, LockKeyhole } from "lucide-react";
import { SERVER_URL, socket } from "../utils/socket.js";

export default function DesktopWebPlayer({ roomId, url, canControl, initialTime = 0, initialPlaying = false }) {
  const webviewRef = useRef(null);
  const [videoFound, setVideoFound] = useState(false);
  const [status, setStatus] = useState("Loading website...");
  const guestPreloadUrl = window.syncwatchDesktop?.guestPreloadUrl;

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const send = (command) => {
      try { webview.send("syncwatch:command", command); } catch {}
    };
    const publishWebState = (state) => fetch(`${SERVER_URL.replace(/\/+$/, "")}/rooms/${roomId}/web-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...state,
        sourceId: "desktop-host",
        eventType: state.eventType || "progress",
        playerDetected: true
      })
    }).catch(() => {});
    const onReady = () => {
      setStatus("Website loaded. Sign in with your own account if required.");
      send({ type: "sync", currentTime: Number(initialTime || 0), isPlaying: Boolean(initialPlaying) });
    };
    const onLoadStart = () => {
      setVideoFound(false);
      setStatus("Loading website...");
    };
    const onLoadFailed = (event) => {
      if (event.errorCode === -3) return;
      setStatus(`Website could not load: ${event.errorDescription || "connection failed"}`);
    };
    const onIpc = (event) => {
      if (event.channel === "syncwatch:video-found") {
        setVideoFound(true);
        setStatus(canControl ? "Video detected - You can control playback" : "Video detected - Controlled by host or moderator");
        return;
      }
      if (event.channel !== "syncwatch:video-state" || !canControl) return;
      const state = event.args?.[0];
      if (!state) return;
      publishWebState(state);
      if (state.eventType === "play") socket.emit("player:play", { roomId, currentTime: state.currentTime });
      if (state.eventType === "pause") socket.emit("player:pause", { roomId, currentTime: state.currentTime });
      if (state.eventType === "seek") socket.emit("player:seek", { roomId, currentTime: state.currentTime });
      if (state.eventType === "progress") socket.emit("player:sync", { roomId, currentTime: state.currentTime, isPlaying: !state.paused });
    };

    const onPlay = (currentTime) => send({ type: "play", currentTime: Number(currentTime || 0) });
    const onPause = (currentTime) => send({ type: "pause", currentTime: Number(currentTime || 0) });
    const onSeek = (currentTime) => send({ type: "seek", currentTime: Number(currentTime || 0) });
    const onSync = ({ currentTime, isPlaying }) => send({ type: "sync", currentTime: Number(currentTime || 0), isPlaying: Boolean(isPlaying) });

    webview.addEventListener("dom-ready", onReady);
    webview.addEventListener("did-start-loading", onLoadStart);
    webview.addEventListener("did-fail-load", onLoadFailed);
    webview.addEventListener("ipc-message", onIpc);
    socket.on("player:play", onPlay);
    socket.on("player:pause", onPause);
    socket.on("player:seek", onSeek);
    socket.on("player:sync", onSync);
    return () => {
      webview.removeEventListener("dom-ready", onReady);
      webview.removeEventListener("did-start-loading", onLoadStart);
      webview.removeEventListener("did-fail-load", onLoadFailed);
      webview.removeEventListener("ipc-message", onIpc);
      socket.off("player:play", onPlay);
      socket.off("player:pause", onPause);
      socket.off("player:seek", onSeek);
      socket.off("player:sync", onSync);
    };
  }, [canControl, initialPlaying, initialTime, roomId, url]);

  return (
    <div className="desktop-web-player">
      <div className="desktop-web-status">
        <span>{status}</span>
        <span><ExternalLink size={14} /> Each viewer streams from the original website</span>
      </div>
      <webview
        ref={webviewRef}
        src={url}
        preload={guestPreloadUrl}
        allowpopups="true"
        partition="persist:syncwatch-web"
      />
      {videoFound && !canControl && (
        <div className="desktop-viewer-lock"><LockKeyhole size={18} /> Host controls playback</div>
      )}
    </div>
  );
}
