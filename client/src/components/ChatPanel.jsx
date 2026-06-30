import { useEffect, useRef, useState } from "react";
import { ImagePlus, Mic, MicOff, PhoneOff, Send, Users } from "lucide-react";
import { socket } from "../utils/socket.js";

export default function ChatPanel({ roomId, username, initialMessages = [], users = [], voice }) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const { voiceOn, muted, voiceStatus, joinVoice, leaveVoice, toggleMute, audioWrapRef } = voice;

  useEffect(() => setMessages(initialMessages.slice(-100)), [initialMessages]);

  useEffect(() => {
    const onMessage = (message) => setMessages((prev) => [...prev.slice(-99), message]);
    socket.on("chat:message", onMessage);
    return () => socket.off("chat:message", onMessage);
  }, []);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages]);

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
