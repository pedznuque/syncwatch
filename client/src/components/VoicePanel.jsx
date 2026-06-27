import { useEffect, useRef, useState } from "react";
import { socket } from "../utils/socket.js";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export default function VoicePanel({ roomId, users, username }) {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("Voice is off");
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioWrapRef = useRef(null);

  const createPeer = (targetSocketId, initiator = false) => {
    if (peersRef.current.has(targetSocketId)) return peersRef.current.get(targetSocketId);

    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(targetSocketId, peer);

    localStreamRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, localStreamRef.current);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("voice:ice-candidate", {
          roomId,
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      let audio = document.getElementById(`audio-${targetSocketId}`);
      if (!audio) {
        audio = document.createElement("audio");
        audio.id = `audio-${targetSocketId}`;
        audio.autoplay = true;
        audio.playsInline = true;
        audioWrapRef.current?.appendChild(audio);
      }
      audio.srcObject = stream;
    };

    if (initiator) {
      peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer).then(() => offer))
        .then((offer) => socket.emit("voice:offer", { roomId, targetSocketId, offer }))
        .catch(() => setStatus("Could not start voice offer."));
    }

    return peer;
  };

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setEnabled(true);
      setMuted(false);
      setStatus(`Voice on as ${username}`);

      users
        .filter((user) => user.socketId !== socket.id)
        .forEach((user) => createPeer(user.socketId, true));
    } catch {
      setStatus("Microphone permission was denied or unavailable.");
    }
  };

  const stopVoice = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    if (audioWrapRef.current) audioWrapRef.current.innerHTML = "";
    setEnabled(false);
    setMuted(false);
    setStatus("Voice is off");
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  };

  useEffect(() => {
    const onOffer = async ({ fromSocketId, offer }) => {
      if (!localStreamRef.current) return;
      const peer = createPeer(fromSocketId, false);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("voice:answer", { targetSocketId: fromSocketId, answer });
    };

    const onAnswer = async ({ fromSocketId, answer }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const onIce = async ({ fromSocketId, candidate }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer || !candidate) return;
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidates.
      }
    };

    const onUserLeft = ({ socketId }) => {
      const peer = peersRef.current.get(socketId);
      if (peer) peer.close();
      peersRef.current.delete(socketId);
      const audio = document.getElementById(`audio-${socketId}`);
      audio?.remove();
    };

    socket.on("voice:offer", onOffer);
    socket.on("voice:answer", onAnswer);
    socket.on("voice:ice-candidate", onIce);
    socket.on("voice:user-left", onUserLeft);

    return () => {
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice-candidate", onIce);
      socket.off("voice:user-left", onUserLeft);
    };
  }, [users]);

  useEffect(() => {
    if (!enabled) return;
    users
      .filter((user) => user.socketId !== socket.id)
      .forEach((user) => createPeer(user.socketId, true));
  }, [users, enabled]);

  return (
    <section className="panel voice-panel">
      <div className="panel-header">
        <div>
          <h2>Voice</h2>
          <p>{status}</p>
        </div>
      </div>

      <div className="voice-actions">
        {!enabled ? (
          <button className="primary" onClick={startVoice}>Join Voice</button>
        ) : (
          <>
            <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
            <button onClick={stopVoice}>Leave Voice</button>
          </>
        )}
      </div>

      <div ref={audioWrapRef} className="remote-audio" />
      <p className="tiny-note">For production voice calls, add a TURN server. STUN alone may fail on strict networks.</p>
    </section>
  );
}
