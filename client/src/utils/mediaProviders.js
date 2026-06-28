function parseUrl(value) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isHost(url, domain) {
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

export function isWebUrl(value) {
  return Boolean(parseUrl(value));
}

export function extractYouTubeId(value) {
  const url = parseUrl(value);
  if (!url) return "";
  if (isHost(url, "youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
  if (!isHost(url, "youtube.com")) return "";

  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || "";
  return "";
}

export function isDirectVideoUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && /\.(mp4|webm|ogg|ogv)(?:$|[?#])/i.test(url.href));
}

export function detectWebMedia(value) {
  const youtubeId = extractYouTubeId(value);
  if (youtubeId) return { mode: "youtube", youtubeId };
  if (isDirectVideoUrl(value)) return { mode: "direct-video", videoUrl: value.trim() };
  return null;
}
