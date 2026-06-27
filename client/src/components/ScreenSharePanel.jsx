import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Gauge, Maximize2, MonitorUp, RotateCw, Square, X } from "lucide-react";
import { socket } from "../utils/socket.js";
import FullscreenChatOverlay from "./FullscreenChatOverlay.jsx";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const QUALITY_MODES = {
  smooth: { label: "Smooth 720p60", width: 1280, height: 720, frameRate: 60, bitrate: 6_000_000, minBitrate: 2_500_000, degradationPreference: "maintain-framerate", contentHint: "motion", codec: "video/H264" },
  high: { label: "Full HD 1080p60", width: 1920, height: 1080, frameRate: 60, bitrate: 12_000_000, minBitrate: 4_500_000, degradationPreference: "maintain-framerate", contentHint: "motion", codec: "video/H264" },
  ultra: { label: "Sharp 1080p30", width: 1920, height: 1080, frameRate: 30, bitrate: 12_000_000, minBitrate: 5_000_000, degradationPreference: "balanced", contentHint: "detail", codec: "video/VP9" }
};

export default function ScreenSharePanel({ roomId, shareInfo, onBack, username }) {
  const [isSharing, setIsSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [status, setStatus] = useState("Choose a browser tab or window to share.");
  const [quality, setQuality] = useState("high");
  const [networkQuality, setNetworkQuality] = useState("Ready");
  const [streamMetrics, setStreamMetrics] = useState("");
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const senderAdaptationRef = useRef(new Map());
  const senderStatsRef = useRef(new Map());
  const qualityRef = useRef("high");

  const configureVideoSender = async (sender, requestedScale) => {
    if (!sender?.track || sender.track.kind !== "video") return;
    const config = QUALITY_MODES[qualityRef.current] || QUALITY_MODES.high;
    try {
      const viewerCount = Math.max(1, peersRef.current.size);
      const targetBitrate = Math.min(config.bitrate, Math.max(config.minBitrate, Math.round(config.bitrate / viewerCount)));
      const scaleResolutionDownBy = requestedScale || senderAdaptationRef.current.get(sender)?.scale || 1;
      const parameters = sender.getParameters();
      // Encodings are created during negotiation. Changing their count before
      // that point is rejected by several browsers.
      if (!parameters.encodings?.length) return false;
      parameters.encodings[0] = {
        ...parameters.encodings[0],
        maxBitrate: targetBitrate,
        maxFramerate: config.frameRate,
        scaleResolutionDownBy: Math.max(1, scaleResolutionDownBy)
      };
      parameters.degradationPreference = config.degradationPreference;
      await sender.setParameters(parameters);
      return true;
    } catch {
      // Some browsers expose the sender but do not allow encoding changes.
      return false;
    }
  };

  const configureAllVideoSenders = () => Promise.all(
    [...peersRef.current.values()]
      .flatMap((peer) => peer.getSenders())
      .map((sender) => configureVideoSender(sender))
  );

  const applyVideoCodecPreference = (peer, sender) => {
    const transceiver = peer.getTransceivers().find((item) => item.sender === sender);
    const codecs = globalThis.RTCRtpSender?.getCapabilities?.("video")?.codecs;
    if (!transceiver?.setCodecPreferences || !codecs?.length) return;
    const preferredCodec = (QUALITY_MODES[qualityRef.current] || QUALITY_MODES.high).codec.toLowerCase();
    // Keep all advertised codecs as fallbacks, but prefer VP9 for the Sharp
    // preset and H.264 for the motion-focused presets.
    const preferred = [...codecs].sort((a, b) => {
      const rank = (codec) => codec.mimeType?.toLowerCase() === preferredCodec ? 0 : 1;
      return rank(a) - rank(b);
    });
    try { transceiver.setCodecPreferences(preferred); } catch {}
  };

  const applyCaptureQuality = async (stream) => {
    const config = QUALITY_MODES[qualityRef.current] || QUALITY_MODES.high;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    track.contentHint = config.contentHint;
    try {
      await track.applyConstraints({
        width: { ideal: config.width },
        height: { ideal: config.height },
        frameRate: { ideal: config.frameRate, max: config.frameRate }
      });
    } catch {
      // Keep the browser-selected capture resolution when unsupported.
    }
  };

  const changeQuality = async (nextQuality) => {
    qualityRef.current = nextQuality;
    setQuality(nextQuality);
    setNetworkQuality(QUALITY_MODES[nextQuality].label);
    if (!localStreamRef.current) return;
    senderAdaptationRef.current.clear();
    senderStatsRef.current.clear();
    await applyCaptureQuality(localStreamRef.current);
    await configureAllVideoSenders();
    for (const [targetSocketId, peer] of peersRef.current) {
      peer.getSenders().filter((sender) => sender.track?.kind === "video")
        .forEach((sender) => applyVideoCodecPreference(peer, sender));
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await configureAllVideoSenders();
        socket.emit("screen:offer", { roomId, targetSocketId, offer });
      } catch {}
    }
  };

  const closePeers = () => {
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();
    senderAdaptationRef.current.clear();
    senderStatsRef.current.clear();
    setStreamMetrics("");
  };

  const createPeer = (targetSocketId, sendStream) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing && existing.connectionState !== "closed") return existing;

    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(targetSocketId, peer);

    if (sendStream && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, localStreamRef.current);
        if (track.kind === "video") {
          applyVideoCodecPreference(peer, sender);
        }
      });
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("screen:ice-candidate", {
          roomId,
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      try {
        if ("jitterBufferTarget" in event.receiver) event.receiver.jitterBufferTarget = 120;
      } catch {}
      remoteStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("Live screen share");
    };

    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) {
        peersRef.current.delete(targetSocketId);
        configureAllVideoSenders();
        if (peer.connectionState === "failed" && !localStreamRef.current) {
          setStatus("Connection failed. Ask the sharer to restart.");
        }
      }
    };

    return peer;
  };

  const stopLocalShare = (notify = true) => {
    const stream = localStreamRef.current;
    localStreamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    closePeers();
    remoteStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsSharing(false);
    setStatus("Screen sharing stopped.");
    if (notify) socket.emit("screen:stop", { roomId });
  };

  const startScreenShare = async () => {
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          displaySurface: "browser",
          width: { ideal: QUALITY_MODES[qualityRef.current].width },
          height: { ideal: QUALITY_MODES[qualityRef.current].height },
          frameRate: { ideal: QUALITY_MODES[qualityRef.current].frameRate, max: QUALITY_MODES[qualityRef.current].frameRate }
        },
        audio: true
      });

      await applyCaptureQuality(nextStream);

      const oldStream = localStreamRef.current;
      oldStream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      closePeers();
      localStreamRef.current = nextStream;
      setIsSharing(true);
      setNetworkQuality(QUALITY_MODES[qualityRef.current].label);
      const surface = nextStream.getVideoTracks()[0]?.getSettings?.().displaySurface;
      setStatus(`You are sharing ${surface || "your screen"} live. Control it in the original tab or window.`);
      if (videoRef.current) videoRef.current.srcObject = nextStream;

      nextStream.getTracks().forEach((track) => {
        track.onended = () => stopLocalShare(true);
      });
      socket.emit("screen:start", { roomId, quality: qualityRef.current });
    } catch (error) {
      if (error.name !== "NotAllowedError") setStatus("Screen sharing is unavailable in this browser.");
    }
  };

  useEffect(() => {
    const flushIce = async (socketId, peer) => {
      const queued = pendingIceRef.current.get(socketId) || [];
      pendingIceRef.current.delete(socketId);
      for (const candidate of queued) {
        try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    };

    const onRequest = async ({ fromSocketId }) => {
      if (!localStreamRef.current) return;
      const peer = createPeer(fromSocketId, true);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await configureAllVideoSenders();
      socket.emit("screen:offer", { roomId, targetSocketId: fromSocketId, offer });
    };

    const onOffer = async ({ fromSocketId, offer }) => {
      const peer = createPeer(fromSocketId, false);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      await flushIce(fromSocketId, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("screen:answer", { roomId, targetSocketId: fromSocketId, answer });
    };

    const onAnswer = async ({ fromSocketId, answer }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
      await flushIce(fromSocketId, peer);
    };

    const onIce = async ({ fromSocketId, candidate }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (peer?.remoteDescription) {
        try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
        return;
      }
      const queued = pendingIceRef.current.get(fromSocketId) || [];
      queued.push(candidate);
      pendingIceRef.current.set(fromSocketId, queued);
    };

    const onStopped = () => {
      if (!localStreamRef.current) {
        closePeers();
        remoteStreamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setStatus("The screen share ended.");
      }
    };

    const onUserLeft = ({ socketId }) => {
      const peer = peersRef.current.get(socketId);
      if (!peer) return;
      peersRef.current.delete(socketId);
      peer.close();
      configureAllVideoSenders();
    };

    socket.on("screen:request", onRequest);
    socket.on("screen:offer", onOffer);
    socket.on("screen:answer", onAnswer);
    socket.on("screen:ice-candidate", onIce);
    socket.on("screen:stopped", onStopped);
    socket.on("voice:user-left", onUserLeft);
    return () => {
      socket.off("screen:request", onRequest);
      socket.off("screen:offer", onOffer);
      socket.off("screen:answer", onAnswer);
      socket.off("screen:ice-candidate", onIce);
      socket.off("screen:stopped", onStopped);
      socket.off("voice:user-left", onUserLeft);
    };
  }, [roomId]);

  // Keep pixels clean when the encoder reports bandwidth or CPU pressure.
  // A modest downscale gives the codec more bits per pixel and is preferable
  // to sending a blocky full-resolution frame.
  useEffect(() => {
    if (!isSharing) return;

    const adapt = async () => {
      let isAdapting = false;
      let lowestBitrate = Number.POSITIVE_INFINITY;
      let metrics = "";
      for (const peer of peersRef.current.values()) {
        for (const sender of peer.getSenders().filter((item) => item.track?.kind === "video")) {
          try {
            const stats = await sender.getStats();
            const outbound = [...stats.values()].find((item) =>
              item.type === "outbound-rtp" && !item.isRemote && (item.kind === "video" || item.mediaType === "video")
            );
            if (!outbound) continue;

            const lastStats = senderStatsRef.current.get(sender);
            const elapsedSeconds = lastStats ? (outbound.timestamp - lastStats.timestamp) / 1000 : 0;
            const bitrateMbps = elapsedSeconds > 0
              ? ((outbound.bytesSent - lastStats.bytesSent) * 8) / elapsedSeconds / 1_000_000
              : 0;
            senderStatsRef.current.set(sender, { timestamp: outbound.timestamp, bytesSent: outbound.bytesSent });
            if (bitrateMbps > 0 && bitrateMbps < lowestBitrate) {
              lowestBitrate = bitrateMbps;
              const resolution = outbound.frameWidth && outbound.frameHeight ? `${outbound.frameWidth}×${outbound.frameHeight}` : "Starting";
              const fps = Math.round(outbound.framesPerSecond || 0);
              metrics = `${resolution} · ${fps || "—"} fps · ${bitrateMbps.toFixed(1)} Mbps`;
            }

            const previous = senderAdaptationRef.current.get(sender) || { scale: 1, stressed: 0, stable: 0 };
            const underPressure = ["bandwidth", "cpu"].includes(outbound.qualityLimitationReason);
            let { scale, stressed, stable } = previous;

            if (underPressure) {
              stressed += 1;
              stable = 0;
              if (stressed >= 2 && scale < 1.5) {
                scale = Math.min(1.5, scale + 0.25);
                stressed = 0;
                await configureVideoSender(sender, scale);
              }
            } else {
              stressed = 0;
              stable += 1;
              if (stable >= 5 && scale > 1) {
                scale = Math.max(1, scale - 0.25);
                stable = 0;
                await configureVideoSender(sender, scale);
              }
            }

            if (scale > 1) isAdapting = true;
            senderAdaptationRef.current.set(sender, { scale, stressed, stable });
          } catch {}
        }
      }
      setNetworkQuality(isAdapting ? "Optimizing clarity for this connection" : QUALITY_MODES[qualityRef.current].label);
      if (metrics) setStreamMetrics(metrics);
    };

    adapt();
    const timer = setInterval(adapt, 3000);
    return () => clearInterval(timer);
  }, [isSharing, quality]);

  useEffect(() => {
    if (shareInfo?.userId && shareInfo.userId !== socket.id && !localStreamRef.current) {
      setStatus(`Connecting to ${shareInfo.username}'s screen…`);
      socket.emit("screen:request", { roomId, sharerSocketId: shareInfo.userId });
    }
  }, [roomId, shareInfo?.userId, shareInfo?.startedAt]);

  // The capture can begin before React mounts the preview video. Attach the
  // retained stream whenever the screen-share stage becomes visible.
  useEffect(() => {
    const stream = localStreamRef.current || remoteStreamRef.current;
    if (!videoRef.current || !stream) return;
    if (videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [isSharing, shareInfo?.userId, shareInfo?.startedAt]);

  useEffect(() => () => {
    if (localStreamRef.current) socket.emit("screen:stop", { roomId });
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    closePeers();
  }, [roomId]);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current.requestFullscreen();
  };

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const hasActiveShare = isSharing || Boolean(shareInfo);
  const isLocalShare = isSharing || shareInfo?.userId === socket.id;

  return (
    <section className="panel screen-share-panel">
      <div className="screen-toolbar">
        <button onClick={onBack} title="Back to media"><ArrowLeft size={17} /> Back</button>
        <div className="screen-toolbar-title">
          <strong>{isLocalShare ? "Your screen" : shareInfo ? `${shareInfo.username}'s screen` : "Screen share"}</strong>
          <span>{status}</span>
          {isLocalShare && streamMetrics && <span className="stream-metrics">Sending {streamMetrics}</span>}
        </div>
        {isLocalShare && (
          <label className="screen-quality-control">
            <Gauge size={16} />
            <select value={quality} onChange={(event) => changeQuality(event.target.value)} aria-label="Screen share quality">
              {Object.entries(QUALITY_MODES).map(([value, mode]) => <option key={value} value={value}>{mode.label}</option>)}
            </select>
          </label>
        )}
        {isLocalShare && <button onClick={startScreenShare}><RotateCw size={17} /> Restart</button>}
        {isLocalShare && <button className="danger" onClick={() => stopLocalShare(true)}><Square size={17} /> Stop</button>}
        <button className="icon-button" onClick={onBack} title="Close screen share view"><X size={17} /></button>
      </div>

      {hasActiveShare ? (
        <div ref={containerRef} className={isFullscreen ? "screen-stage fullscreen" : "screen-stage"}>
          <video ref={videoRef} autoPlay playsInline muted={isLocalShare} controls={!isLocalShare} />
          <button className="screen-stage-fullscreen" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <Maximize2 size={18} />
          </button>
          {isFullscreen && <FullscreenChatOverlay roomId={roomId} username={username} />}
        </div>
      ) : (
        <div className="screen-share-start">
          <MonitorUp size={48} />
          <h3>Share a browser tab, window, or screen</h3>
          <p>For streaming sites: open the official video, choose that browser tab, and enable “Share tab audio”.</p>
          <label className="screen-quality-control screen-quality-picker">
            <Gauge size={17} />
            <span>Quality</span>
            <select value={quality} onChange={(event) => changeQuality(event.target.value)}>
              {Object.entries(QUALITY_MODES).map(([value, mode]) => <option key={value} value={value}>{mode.label}</option>)}
            </select>
          </label>
          <small className="screen-quality-note">{networkQuality} · Higher modes need a fast upload connection.</small>
          <button className="primary" onClick={startScreenShare}><MonitorUp size={18} /> Choose screen to share</button>
        </div>
      )}
    </section>
  );
}
