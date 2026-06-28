export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export async function loadIceServers() {
  try {
    const origin = import.meta.env.VITE_SERVER_URL
      || (import.meta.env.PROD ? window.location.origin : "http://localhost:5000");
    const response = await fetch(`${origin}/ice-config`);
    if (!response.ok) throw new Error("ICE configuration unavailable");
    const data = await response.json();
    return Array.isArray(data.iceServers) && data.iceServers.length
      ? data.iceServers
      : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}
