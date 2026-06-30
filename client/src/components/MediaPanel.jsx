import { useEffect, useRef, useState } from "react";
import { Clock3, FastForward, Globe2, Maximize2, MonitorPlay, Pause, Play, Rewind, RotateCw, SendHorizontal, Volume2, VolumeX, X, Settings } from "lucide-react";
import { socket } from "../utils/socket.js";
import { extractYouTubeId, isWebUrl } from "../utils/mediaProviders.js";
import FullscreenChatOverlay from "./FullscreenChatOverlay.jsx";
import WebStreamPanel from "./WebStreamPanel.jsx";

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    }
  });
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}` : `${minutes}:${tail}`;
}

function parseTime(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export default function MediaPanel({ roomId, state, username, isHost, voice }) {
  const videoRef = useRef(null);
  const youtubeRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const playerContainerRef = useRef(null);
  const ignoreRemoteRef = useRef(false);
  
  const [mode, setMode] = useState(state?.mode || "web");
  const [videoUrl, setVideoUrl] = useState(state?.videoUrl || "");
  const [youtubeId, setYoutubeId] = useState(state?.youtubeId || "");
  const [webUrl, setWebUrl] = useState(state?.externalUrl || "");
  const [webState, setWebState] = useState(state?.webSync || null);
  const [draftUrl, setDraftUrl] = useState("");
  const [quality, setQuality] = useState(state?.quality || "high");
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [timestampDraft, setTimestampDraft] = useState("");
  const isDesktop = Boolean(window.syncwatchDesktop?.isDesktop);
  
  const VALID_MODES = ["direct-video", "youtube", "web"];
  const activeMode = VALID_MODES.includes(mode) ? mode : "direct-video";

  useEffect(() => {
    if (!state) return;
    const nextMode = VALID_MODES.includes(state.mode) ? state.mode : "direct-video";
    setMode(nextMode);
    setVideoUrl(state.videoUrl || "");
    setYoutubeId(state.youtubeId || "");
    setWebUrl(state.externalUrl || state.webSync?.url || "");
    setWebState(state.webSync || null);
    setQuality(state.quality || "high");
    setCurrentTime(Number(state.currentTime || 0));
    setIsPlaying(Boolean(state.isPlaying));
  }, [state]);

  useEffect(() => {
    if (activeMode !== "youtube" || !youtubeId || !youtubeRef.current) return;
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !youtubeRef.current) return;
      youtubeRef.current.innerHTML = "";
      const mount = document.createElement("div");
      youtubeRef.current.appendChild(mount);
      ytPlayerRef.current = new YT.Player(mount, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          fs: 1,
          origin: window.location.origin,
          quality: quality === "auto" ? "default" : "hd720"
        },
        events: {
          onReady: () => {
            setDuration(ytPlayerRef.current?.getDuration?.() || 0);
            const initialTime = Number(state?.currentTime || 0);
            if (initialTime > 0) ytPlayerRef.current?.seekTo?.(initialTime, true);
            if (state?.isPlaying) ytPlayerRef.current?.playVideo?.();
            if (quality !== "auto" && ytPlayerRef.current?.setPlaybackQuality) {
              ytPlayerRef.current.setPlaybackQuality(quality === "high" ? "hd1080" : quality === "medium" ? "hd720" : "large");
            }
          },
          onStateChange: (event) => {
            if (ignoreRemoteRef.current) return;
            const currentTime = ytPlayerRef.current?.getCurrentTime?.() || 0;
            if (event.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              socket.emit("player:play", { roomId, currentTime });
            }
            if (event.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              socket.emit("player:pause", { roomId, currentTime });
            }
          }
        }
      });
    });
    return () => {
      cancelled = true;
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
    };
  }, [activeMode, youtubeId, roomId, playerKey, quality, state?.currentTime, state?.isPlaying]);

  useEffect(() => {
    const onMedia = (media) => {
      const nextMode = VALID_MODES.includes(media.mode) ? media.mode : "direct-video";
      setMode(nextMode);
      setVideoUrl(media.videoUrl || "");
      setYoutubeId(media.youtubeId || "");
      setWebUrl(media.externalUrl || "");
      setQuality(media.quality || "high");
    };
    const guard = async (action) => {
      ignoreRemoteRef.current = true;
      await action();
      setTimeout(() => { ignoreRemoteRef.current = false; }, 400);
    };
    const setTime = (time) => {
      const nextTime = Number(time || 0);
      if (activeMode === "youtube" && ytPlayerRef.current) ytPlayerRef.current.seekTo(nextTime, true);
      else if (videoRef.current) videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    };
    const onPlay = (time) => guard(async () => {
      setTime(time);
      setIsPlaying(true);
      if (activeMode === "youtube") ytPlayerRef.current?.playVideo?.();
      else if (activeMode === "direct-video") {
        await videoRef.current?.play?.().catch(() => {});
      }
    });
    const onPause = (time) => guard(async () => {
      setTime(time);
      setIsPlaying(false);
      if (activeMode === "youtube") ytPlayerRef.current?.pauseVideo?.();
      else if (videoRef.current) videoRef.current?.pause?.();
    });
    const onSync = ({ currentTime: remoteTime, isPlaying: remotePlaying }) => guard(async () => {
      const localTime = activeMode === "youtube"
        ? (ytPlayerRef.current?.getCurrentTime?.() || 0)
        : (videoRef.current?.currentTime || 0);
      if (Math.abs(localTime - Number(remoteTime || 0)) > 1.5) setTime(remoteTime);
      setIsPlaying(Boolean(remotePlaying));
      if (remotePlaying) {
        if (activeMode === "youtube") ytPlayerRef.current?.playVideo?.();
        else if (videoRef.current?.paused) await videoRef.current.play().catch(() => {});
      } else if (activeMode === "youtube") ytPlayerRef.current?.pauseVideo?.();
      else videoRef.current?.pause?.();
    });
    const onWebState = (nextState) => {
      setWebState(nextState);
      if (nextState.url) setWebUrl(nextState.url);
    };
    socket.on("room:media", onMedia);
    socket.on("player:play", onPlay);
    socket.on("player:pause", onPause);
    socket.on("player:seek", setTime);
    socket.on("player:sync", onSync);
    socket.on("web:state", onWebState);
    return () => {
      socket.off("room:media", onMedia);
      socket.off("player:play", onPlay);
      socket.off("player:pause", onPause);
      socket.off("player:seek", setTime);
      socket.off("player:sync", onSync);
      socket.off("web:state", onWebState);
    };
  }, [activeMode]);

  useEffect(() => {
    if (activeMode === "web") return;
    const timer = setInterval(() => {
      if (activeMode === "youtube") {
        setCurrentTime(ytPlayerRef.current?.getCurrentTime?.() || 0);
        setDuration(ytPlayerRef.current?.getDuration?.() || 0);
      } else if (videoRef.current && activeMode === "direct-video") {
        setCurrentTime(videoRef.current.currentTime || 0);
        setDuration(videoRef.current.duration || 0);
        setIsPlaying(!videoRef.current.paused);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activeMode, youtubeId, videoUrl]);

  useEffect(() => {
    if (!isHost || activeMode === "web" || !isPlaying) return;
    const timer = setInterval(() => {
      const time = activeMode === "youtube"
        ? (ytPlayerRef.current?.getCurrentTime?.() || 0)
        : (videoRef.current?.currentTime || 0);
      socket.emit("player:sync", { roomId, currentTime: time, isPlaying: true });
    }, 10000);
    return () => clearInterval(timer);
  }, [isHost, isPlaying, activeMode, roomId]);

  const setMedia = () => {
    const cleanUrl = draftUrl.trim();
    if (!isWebUrl(cleanUrl)) return alert("Please paste a valid http:// or https:// link.");

    let mediaData = {
      roomId,
      mode: activeMode,
      quality,
      videoUrl: "",
      youtubeId: "",
      externalUrl: ""
    };

    if (activeMode === "youtube") {
      const ytId = extractYouTubeId(cleanUrl);
      if (!ytId) return alert("Please paste a valid YouTube URL.");
      mediaData.youtubeId = ytId;
    } else if (activeMode === "direct-video") {
      mediaData.videoUrl = cleanUrl;
    } else if (activeMode === "web") {
      mediaData.externalUrl = cleanUrl;
      if (!isDesktop) {
        const popup = window.open(cleanUrl, `syncwatch-stream-${roomId}`, "popup=yes,width=1280,height=800,resizable=yes,scrollbars=yes");
        if (popup) {
          try { popup.opener = null; } catch {}
          popup.focus();
        }
      }
    }

    socket.emit("room:set-media", mediaData);
    setDraftUrl("");
  };

  const clearPlayer = () => socket.emit("room:set-media", {
    roomId,
    mode: "direct-video",
    videoUrl: "",
    youtubeId: "",
    externalUrl: "",
    quality
  });

  const restartPlayer = () => {
    if (activeMode === "youtube") {
      ytPlayerRef.current?.seekTo?.(0, true);
      ytPlayerRef.current?.playVideo?.();
    } else if (videoRef.current && activeMode === "direct-video") {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    } else setPlayerKey((value) => value + 1);
  };

  const seekTo = (value) => {
    const nextTime = Math.max(0, Math.min(Number(value) || 0, duration || Number.MAX_SAFE_INTEGER));
    if (activeMode === "youtube") ytPlayerRef.current?.seekTo?.(nextTime, true);
    else if (videoRef.current) videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    socket.emit("player:seek", { roomId, currentTime: nextTime });
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      if (activeMode === "youtube") ytPlayerRef.current?.pauseVideo?.();
      else if (videoRef.current && activeMode === "direct-video") videoRef.current?.pause?.();
      setIsPlaying(false);
    } else {
      if (activeMode === "youtube") ytPlayerRef.current?.playVideo?.();
      else if (videoRef.current && activeMode === "direct-video") await videoRef.current?.play?.().catch(() => {});
      setIsPlaying(true);
    }
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    if (activeMode === "youtube") ytPlayerRef.current?.[nextMuted ? "mute" : "unMute"]?.();
    else if (videoRef.current && activeMode === "direct-video") videoRef.current.muted = nextMuted;
    setMuted(nextMuted);
  };

  const enableViewerPlayback = async () => {
    if (activeMode === "youtube") {
      ytPlayerRef.current?.unMute?.();
      if (isPlaying) ytPlayerRef.current?.playVideo?.();
    } else if (activeMode === "direct-video" && videoRef.current) {
      videoRef.current.muted = false;
      if (isPlaying) await videoRef.current.play().catch(() => {});
    }
  };

  const jumpToTimestamp = () => {
    const seconds = parseTime(timestampDraft);
    if (seconds === null) return alert("Enter a timestamp such as 1:23 or 1:02:30.");
    seekTo(seconds);
    setTimestampDraft("");
    setShowTimestamp(false);
  };

  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await playerContainerRef.current.requestFullscreen();
  };

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === playerContainerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const hasMedia = 
    (activeMode === "direct-video" && videoUrl) ||
    (activeMode === "youtube" && youtubeId);
  const getModeLabel = () => {
    const labels = {
      "direct-video": "Direct",
      "youtube": "YouTube",
      "web": "Web"
    };
    return labels[activeMode] || "Direct";
  };

  const getPlaceholder = () => {
    const placeholders = {
      "direct-video": "Paste direct .mp4 or .webm URL",
      "youtube": "Paste YouTube URL (youtube.com/watch?v=...)",
      "web": "Paste the streaming page URL opened by every viewer"
    };
    return placeholders[activeMode] || "Paste URL";
  };

  return (
    <section className="panel media-panel cinema-panel">
      <div className="panel-header media-header">
        <div>
          <h2><MonitorPlay size={22} /> Media</h2>
          <p>Every viewer streams from the original website while SyncWatch keeps playback aligned.</p>
        </div>
        <div className="header-controls">
          <span className="mode-chip">{getModeLabel()}</span>
          {isHost && activeMode !== "web" && <div className="quality-selector-wrap">
            <button 
              className="quality-btn" 
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              title="Video Quality"
            >
              <Settings size={18} />
              {quality.charAt(0).toUpperCase() + quality.slice(1)}
            </button>
            {showQualityMenu && (
              <div className="quality-menu">
                {["low", "medium", "high", "auto"].map(q => (
                  <button
                    key={q}
                    className={quality === q ? "active" : ""}
                    onClick={() => {
                      setQuality(q);
                      setShowQualityMenu(false);
                      socket.emit("room:set-media", {
                        roomId, mode: activeMode, quality: q,
                        videoUrl, youtubeId, externalUrl: webUrl
                      });
                    }}
                  >
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>}
        </div>
      </div>

      <div className="mode-tabs segmented web-mode-tabs">
        {["web", "youtube", "direct-video"].map(m => (
          <button
            key={m}
            className={activeMode === m ? "active" : ""}
            onClick={() => setMode(m)}
          >
            {m === "direct-video" ? "Direct" : m === "youtube" ? "YouTube" : <><Globe2 size={16} /> Web</>}
          </button>
        ))}
      </div>

      <div className="media-input elevated-input">
        <input
          value={draftUrl}
          placeholder={getPlaceholder()}
          disabled={!isHost}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && setMedia()}
        />
        <button className="primary" disabled={!isHost} onClick={setMedia}><SendHorizontal size={17} /> Set</button>
      </div>

      {activeMode === "web" ? (
        <WebStreamPanel
          roomId={roomId}
          webUrl={webUrl}
          webState={webState}
          isHost={isHost}
          isDesktop={isDesktop}
          username={username}
          voice={voice}
        />
      ) : <div ref={playerContainerRef} className={isFullscreen ? "media-stage fullscreen" : "media-stage"}>
        {hasMedia && isHost && (
          <div className="player-overlay-actions">
            <button className="player-overlay-button" onClick={restartPlayer} title="Restart"><RotateCw size={16} /></button>
            <button className="player-overlay-button danger" onClick={clearPlayer} title="Remove"><X size={16} /></button>
          </div>
        )}
        
        {activeMode === "direct-video" && videoUrl ? (
          <div className="synced-player-frame">
          <video ref={videoRef} src={videoUrl} className="video"
            onLoadedMetadata={() => {
              const player = videoRef.current;
              if (!player) return;
              setDuration(player.duration || 0);
              player.currentTime = Number(state?.currentTime || 0);
              if (state?.isPlaying) player.play().catch(() => {});
            }}
            onPlay={() => {
              setIsPlaying(true);
              if (!ignoreRemoteRef.current) socket.emit("player:play", { roomId, currentTime: videoRef.current.currentTime });
            }}
            onPause={() => {
              setIsPlaying(false);
              if (!ignoreRemoteRef.current) socket.emit("player:pause", { roomId, currentTime: videoRef.current.currentTime });
            }}
            onSeeked={() => !ignoreRemoteRef.current && socket.emit("player:seek", { roomId, currentTime: videoRef.current.currentTime })} />
            {!isHost && <div className="viewer-player-shield"><button onClick={enableViewerPlayback}>Viewer · Enable playback</button></div>}
          </div>
        ) : activeMode === "youtube" && youtubeId ? (
          <div className="synced-player-frame">
            <div key={playerKey} className="youtube-player" ref={youtubeRef} />
            {!isHost && <div className="viewer-player-shield"><button onClick={enableViewerPlayback}>Viewer · Enable playback</button></div>}
          </div>
        ) : (
          <div className="empty-player"><MonitorPlay size={46} /><span>Set a media or website URL to start.</span></div>
        )}

        {hasMedia && isHost && (
          <div className="media-control-wrap">
            {isHost && showTimestamp && (
              <div className="host-timestamp-jump">
                <input
                  value={timestampDraft}
                  placeholder="Timestamp 1:23"
                  onChange={(event) => setTimestampDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && jumpToTimestamp()}
                />
                <button onClick={jumpToTimestamp}>Go</button>
              </div>
            )}
            <div className="media-control-bar">
              <button onClick={() => seekTo(currentTime - 5)} title="Back 5 seconds"><Rewind size={18} /><span>5</span></button>
              <button className="main-play-control" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button onClick={() => seekTo(currentTime + 5)} title="Forward 5 seconds"><FastForward size={18} /><span>5</span></button>
              <span className="media-time-label">{formatTime(currentTime)} / {formatTime(duration)}</span>
              <input
                className="media-progress"
                type="range"
                min="0"
                max={Math.max(duration, 1)}
                step="0.1"
                value={Math.min(currentTime, Math.max(duration, 1))}
                onChange={(event) => {
                  const nextTime = Number(event.target.value);
                  if (activeMode === "youtube") ytPlayerRef.current?.seekTo?.(nextTime, true);
                  else if (videoRef.current) videoRef.current.currentTime = nextTime;
                  setCurrentTime(nextTime);
                }}
                onPointerUp={() => socket.emit("player:seek", { roomId, currentTime })}
                onKeyUp={() => socket.emit("player:seek", { roomId, currentTime })}
                aria-label="Media progress"
              />
              <button onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
              {isHost && <button className={showTimestamp ? "active" : ""} onClick={() => setShowTimestamp((value) => !value)} title="Jump everyone to timestamp"><Clock3 size={18} /></button>}
              <button onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}><Maximize2 size={18} /></button>
            </div>
          </div>
        )}
        {isFullscreen && <FullscreenChatOverlay roomId={roomId} username={username} voice={voice} />}
      </div>}
    </section>
  );
}
