const MEDIA_EXTENSIONS = new Map([
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".ogg", "video/ogg"],
  [".ogv", "video/ogg"],
  [".m3u8", "application/vnd.apple.mpegurl"]
]);

function getMediaType(pathname) {
  const normalizedPath = pathname.toLowerCase();
  for (const [extension, contentType] of MEDIA_EXTENSIONS) {
    if (normalizedPath.endsWith(extension)) return contentType;
  }
  return null;
}

export const streamExtractor = {
  async extractStream(value) {
    let url;

    try {
      url = new URL(String(value).trim());
    } catch {
      throw new Error("A valid media URL is required");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Only HTTP and HTTPS media URLs are supported");
    }

    const contentType = getMediaType(url.pathname);
    if (!contentType) {
      throw new Error("URL must point to an MP4, WebM, OGG, or HLS media file");
    }

    return {
      url: url.toString(),
      contentType,
      format: url.pathname.split(".").pop().toLowerCase()
    };
  }
};
