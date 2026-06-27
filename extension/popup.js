const $ = (id) => document.getElementById(id);

function message(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!response?.ok) return reject(new Error(response?.error || "Extension request failed"));
      resolve(response.data);
    });
  });
}

async function init() {
  const config = await message({ type: "get-config" });
  $("serverUrl").value = config.serverUrl;
  $("roomId").value = config.roomId;
  $("role").value = config.role;
  $("enabled").checked = config.enabled;
  if (!config.roomId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const match = tab?.url?.match(/\/room\/([^/?#]+)/);
    if (match) $("roomId").value = decodeURIComponent(match[1]);
  }
}

async function save() {
  try {
    const config = {
      serverUrl: $("serverUrl").value.trim().replace(/\/$/, ""),
      roomId: $("roomId").value.trim(),
      role: $("role").value,
      enabled: $("enabled").checked
    };
    await message({ type: "save-config", config });
    const room = await message({ type: "api", path: `/rooms/${encodeURIComponent(config.roomId)}/web-sync` });
    $("status").textContent = `Connected · ${config.role === "controller" ? "publishing this browser" : "following the controller"}${room.title ? ` · ${room.title}` : ""}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function openSynced() {
  try {
    const roomId = $("roomId").value.trim();
    const state = await message({ type: "api", path: `/rooms/${encodeURIComponent(roomId)}/web-sync` });
    if (!state.url) throw new Error("The controller has not detected a video yet.");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.update(tab.id, { url: state.url });
    window.close();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

$("save").addEventListener("click", save);
$("open").addEventListener("click", openSynced);
init().catch((error) => { $("status").textContent = error.message; });
