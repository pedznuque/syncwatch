import { useEffect, useRef, useState } from "react";
import { socket } from "../utils/socket.js";
import { DEFAULT_ICE_SERVERS, loadIceServers } from "../utils/iceServers.js";

export function useVoiceChat(roomId) {
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice off");
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const retryTimersRef = useRef(new Map());
  const audioWrapRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const voiceOnRef = useRef(false);

  const removePeer = (socketId) => {
    clearTimeout(retryTimersRef.current.get(socketId));
    retryTimersRef.current.delete(socketId);
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);
    pendingIceRef.current.delete(socketId);
    document.getElementById(`audio-${socketId}`)?.remove();
  };

  const flushIce = async (socketId, peer) => {
    const queued = pendingIceRef.current.get(socketId) || [];
    pendingIceRef.current.delete(socketId);
    for (const candidate of queued) {
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  };

  const createPeer = (targetSocketId) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing && existing.signalingState !== "closed") return existing;

    const peer = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 4
    });
    peersRef.current.set(targetSocketId, peer);
    localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));

    peer.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit("voice:ice-candidate", { roomId, targetSocketId, candidate });
    };
    peer.onicecandidateerror = () => setVoiceStatus("Voice is retrying the network connection...");
    peer.ontrack = ({ streams, track }) => {
      const stream = streams[0] || new MediaStream([track]);
      let audio = document.getElementById(`audio-${targetSocketId}`);
      if (!audio) {
        audio = document.createElement("audio");
        audio.id = `audio-${targetSocketId}`;
        audio.autoplay = true;
        audio.playsInline = true;
        audioWrapRef.current?.appendChild(audio);
      }
      audio.srcObject = stream;
      audio.play().catch(() => setVoiceStatus("Tap the mic button once more to enable audio."));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        clearTimeout(retryTimersRef.current.get(targetSocketId));
        setVoiceStatus("Voice connected");
      } else if (peer.connectionState === "failed") {
        makeOffer(targetSocketId, true);
      } else if (peer.connectionState === "disconnected") {
        clearTimeout(retryTimersRef.current.get(targetSocketId));
        retryTimersRef.current.set(targetSocketId, setTimeout(() => {
          if (peer.connectionState === "disconnected") makeOffer(targetSocketId, true);
        }, 3000));
      }
    };
    return peer;
  };

  const makeOffer = async (targetSocketId, iceRestart = false) => {
    if (!voiceOnRef.current || !socket.id || socket.id.localeCompare(targetSocketId) > 0) return;
    const peer = createPeer(targetSocketId);
    try {
      if (iceRestart) peer.restartIce?.();
      const offer = await peer.createOffer({ iceRestart });
      await peer.setLocalDescription(offer);
      socket.emit("voice:offer", { roomId, targetSocketId, offer: peer.localDescription });
      setVoiceStatus(iceRestart ? "Reconnecting voice..." : "Connecting voice...");
    } catch {
      setVoiceStatus("Voice connection failed. Retrying...");
    }
  };

  const joinVoice = async () => {
    if (voiceOnRef.current) return;
    try {
      iceServersRef.current = await loadIceServers();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      localStreamRef.current = stream;
      voiceOnRef.current = true;
      setVoiceOn(true);
      setMuted(false);
      setVoiceStatus("Finding friends in voice...");
      socket.emit("voice:join", { roomId });
    } catch (error) {
      setVoiceStatus(error?.name === "NotAllowedError" ? "Microphone permission denied" : "Microphone is unavailable");
    }
  };

  const leaveVoice = () => {
    if (voiceOnRef.current) socket.emit("voice:leave", { roomId });
    voiceOnRef.current = false;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    [...peersRef.current.keys()].forEach(removePeer);
    setVoiceOn(false);
    setMuted(false);
    setVoiceStatus("Voice off");
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
    setVoiceStatus(nextMuted ? "Muted" : "Voice on");
  };

  useEffect(() => {
    loadIceServers().then((servers) => { iceServersRef.current = servers; });

    const onPeers = ({ roomId: eventRoomId, socketIds = [] }) => {
      if (eventRoomId !== roomId || !voiceOnRef.current) return;
      if (!socketIds.length) setVoiceStatus("Voice on - waiting for others");
      socketIds.forEach((socketId) => makeOffer(socketId));
    };
    const onUserJoined = ({ roomId: eventRoomId, socketId }) => {
      if (eventRoomId === roomId && voiceOnRef.current) makeOffer(socketId);
    };
    const onOffer = async ({ roomId: eventRoomId, fromSocketId, offer }) => {
      if (eventRoomId !== roomId || !voiceOnRef.current) return;
      const peer = createPeer(fromSocketId);
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        await flushIce(fromSocketId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("voice:answer", { roomId, targetSocketId: fromSocketId, answer: peer.localDescription });
      } catch {
        removePeer(fromSocketId);
        setVoiceStatus("Voice negotiation failed. Rejoin voice to retry.");
      }
    };
    const onAnswer = async ({ roomId: eventRoomId, fromSocketId, answer }) => {
      if (eventRoomId !== roomId) return;
      const peer = peersRef.current.get(fromSocketId);
      if (!peer) return;
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        await flushIce(fromSocketId, peer);
      } catch {}
    };
    const onIce = async ({ roomId: eventRoomId, fromSocketId, candidate }) => {
      if (eventRoomId !== roomId || !candidate) return;
      const peer = peersRef.current.get(fromSocketId);
      if (peer?.remoteDescription) {
        try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      } else {
        const queued = pendingIceRef.current.get(fromSocketId) || [];
        queued.push(candidate);
        pendingIceRef.current.set(fromSocketId, queued);
      }
    };
    const onUserLeft = ({ roomId: eventRoomId, socketId }) => {
      if (eventRoomId === roomId) removePeer(socketId);
    };
    const onSocketConnect = () => {
      if (voiceOnRef.current) socket.emit("voice:join", { roomId });
    };

    socket.on("connect", onSocketConnect);
    socket.on("voice:peers", onPeers);
    socket.on("voice:user-joined", onUserJoined);
    socket.on("voice:offer", onOffer);
    socket.on("voice:answer", onAnswer);
    socket.on("voice:ice-candidate", onIce);
    socket.on("voice:user-left", onUserLeft);
    return () => {
      socket.off("connect", onSocketConnect);
      socket.off("voice:peers", onPeers);
      socket.off("voice:user-joined", onUserJoined);
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice-candidate", onIce);
      socket.off("voice:user-left", onUserLeft);
      leaveVoice();
    };
  }, [roomId]);

  return { voiceOn, muted, voiceStatus, joinVoice, leaveVoice, toggleMute, audioWrapRef };
}
