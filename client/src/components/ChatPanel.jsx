import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, MicOff, PhoneOff, Send, Users } from "lucide-react";
import { socket } from "../utils/socket.js";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export default function ChatPanel({ roomId, username, initialMessages = [], users = [] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice off");
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioWrapRef = useRef(null);

  useEffect(() => setMessages(initialMessages.slice(-100)), [initialMessages]);

  useEffect(() => {
    const onMessage = (message) => setMessages((prev) => [...prev.slice(-99), message]);
    socket.on("chat:message", onMessage);
    return () => socket.off("chat:message", onMessage);
  }, []);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

  const createPeer = (targetSocketId, initiator = false) => {
    if (peersRef.current.has(targetSocketId)) return peersRef.current.get(targetSocketId);
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(targetSocketId, peer);

    localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));

    peer.onicecandidate = (event) => {
      if (event.candidate) socket.emit("voice:ice-candidate", { roomId, targetSocketId, candidate: event.candidate });
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
        .catch(() => setVoiceStatus("Could not start voice."));
    }

    return peer;
  };

  const joinVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setVoiceOn(true);
      setMuted(false);
      setVoiceStatus("Voice on");
      users.filter((user) => user.socketId !== socket.id).forEach((user) => createPeer(user.socketId, true));
    } catch {
      setVoiceStatus("Mic permission denied");
    }
  };

  const leaveVoice = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    if (audioWrapRef.current) audioWrapRef.current.innerHTML = "";
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
      if (peer) await peer.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const onIce = async ({ fromSocketId, candidate }) => {
      const peer = peersRef.current.get(fromSocketId);
      if (!peer || !candidate) return;
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    };

    const onUserLeft = ({ socketId }) => {
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      document.getElementById(`audio-${socketId}`)?.remove();
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
  }, [users, roomId]);

  useEffect(() => {
    if (!voiceOn) return;
    users.filter((user) => user.socketId !== socket.id).forEach((user) => createPeer(user.socketId, true));
  }, [users, voiceOn]);

  const loadImage = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please choose an image file.");
    if (file.size > 2 * 1024 * 1024) return alert("Image must be below 2 MB for this MVP.");
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  };

  const pickImage = (event) => loadImage(event.target.files?.[0]);

  const pasteImage = (event) => {
    const imageItem = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile() || [...(event.clipboardData?.files || [])]
      .find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    loadImage(file);
  };

  const send = () => {
    if (!text.trim() && !image) return;
    socket.emit("chat:message", { roomId, username, text, image });
    setText("");
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <section className="panel chat-panel right-chat-panel">
      <div className="chat-top">
        <div>
          <h2>Room chat</h2>
          <p><Users size={14} /> {users.length} inside · {voiceStatus}</p>
        </div>
        <div className="voice-icons">
          {!voiceOn ? (
            <button className="icon-button primary" title="Join voice" onClick={joinVoice}><Mic size={18} /></button>
          ) : (
            <>
              <button className="icon-button" title={muted ? "Unmute" : "Mute"} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
              <button className="icon-button danger" title="Leave voice" onClick={leaveVoice}><PhoneOff size={18} /></button>
            </>
          )}
        </div>
      </div>

      <div className="messages custom-scroll">
        {messages.map((message) => {
          const isOwn = !message.system && (message.senderSocketId === socket.id || (!message.senderSocketId && message.username === username));
          const className = message.system ? "message system-message" : `message ${isOwn ? "own-message" : "friend-message"}`;
          return (
            <div className={className} key={message.id || message.createdAt}>
              <div className="message-meta">
                <strong>{isOwn ? "You" : message.username}</strong>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              {message.text && <p>{message.text}</p>}
              {message.image && <img className="chat-image" src={message.image} alt="Shared in chat" />}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {image && (
        <div className="image-preview compact-preview">
          <img src={image} alt="Preview" />
          <button onClick={() => setImage(null)}>Remove</button>
        </div>
      )}

      <div className="chat-composer">
        <button className="icon-button" onClick={() => fileRef.current?.click()} title="Send picture"><ImagePlus size={18} /></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <input value={text} placeholder="Message or paste an image…" onPaste={pasteImage} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="icon-button primary" onClick={send} title="Send"><Send size={18} /></button>
      </div>

      <div ref={audioWrapRef} className="remote-audio" />
    </section>
  );
}
