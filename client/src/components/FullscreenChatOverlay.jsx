import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, MessageCircle, Mic, MicOff, PhoneOff, Send, X } from "lucide-react";
import { socket } from "../utils/socket.js";

const MESSAGE_LIFETIME = 11000;
const LANE_COUNT = 9;

export default function FullscreenChatOverlay({ roomId, username, voice }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [showInput, setShowInput] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const timersRef = useRef(new Set());
  const laneRef = useRef(0);

  useEffect(() => {
    const onMessage = (message) => {
      const floatingId = `${message.id || message.createdAt || Date.now()}-${Math.random()}`;
      const lane = laneRef.current++ % LANE_COUNT;
      const duration = 8.5 + Math.random() * 2.5;
      setMessages((current) => [...current.slice(-19), { ...message, floatingId, lane, duration }]);
      const timer = setTimeout(() => {
        setMessages((current) => current.filter((item) => item.floatingId !== floatingId));
        timersRef.current.delete(timer);
      }, MESSAGE_LIFETIME);
      timersRef.current.add(timer);
    };
    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, []);

  const send = () => {
    const cleanText = text.trim();
    if (!cleanText) return;
    socket.emit("chat:message", { roomId, username, text: cleanText });
    setText("");
  };
  const voiceOn = Boolean(voice?.voiceOn);
  const muted = Boolean(voice?.muted);

  return (
    <div className="fullscreen-danmaku-ui">
      <div className={showComments ? "danmaku-comment-layer" : "danmaku-comment-layer comments-hidden"} aria-live="polite">
        {messages.map((message) => (
          <div
            className="danmaku-comment"
            key={message.floatingId}
            style={{
              top: `${7 + message.lane * 8}%`,
              animationDuration: `${message.duration}s`
            }}
          >
            <strong>{message.username || "Guest"}:</strong>
            <span>{message.text || (message.image ? "shared an image" : "sent a message")}</span>
          </div>
        ))}
      </div>

      <div className={showInput ? "danmaku-input-dock" : "danmaku-input-dock compact"}>
        {showInput ? (
          <>
            <MessageCircle size={18} />
            <input
              value={text}
              placeholder="Send a floating comment..."
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
            />
            <button onClick={send} title="Send floating comment"><Send size={17} /></button>
            <button onClick={() => setShowComments((value) => !value)} title={showComments ? "Hide comments" : "Show comments"}>
              {showComments ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            {!voiceOn ? (
              <button onClick={voice?.joinVoice} title="Join voice"><Mic size={17} /></button>
            ) : (
              <>
                <button onClick={voice?.toggleMute} title={muted ? "Unmute" : "Mute"}>{muted ? <MicOff size={17} /> : <Mic size={17} />}</button>
                <button onClick={voice?.leaveVoice} title="Leave voice"><PhoneOff size={17} /></button>
              </>
            )}
            <button onClick={() => setShowInput(false)} title="Hide comment input"><X size={17} /></button>
          </>
        ) : (
          <>
            <button onClick={() => setShowInput(true)} title="Show comment input"><MessageCircle size={19} /></button>
            <button onClick={() => setShowComments((value) => !value)} title={showComments ? "Hide comments" : "Show comments"}>
              {showComments ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button onClick={voiceOn ? voice?.toggleMute : voice?.joinVoice} title={voiceOn ? (muted ? "Unmute" : "Mute") : "Join voice"}>
              {voiceOn && muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
