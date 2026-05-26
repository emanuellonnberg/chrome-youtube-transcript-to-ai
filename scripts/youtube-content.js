const {
  getPromptPresetLabel,
  getQuickPresetDefinitions,
  normalizeSettings
} = globalThis.YTTA_PROMPTS;

const POT_POLL_INTERVAL_MS = 50;
const POT_POLL_ATTEMPTS = 20;
const INLINE_ROOT_ID = "ytta-inline-actions";
const INLINE_STYLE_ID = "ytta-inline-actions-style";
const INLINE_RENDER_DELAY_MS = 150;
const STATUS_HOLD_MS = 4000;
const INLINE_ANCHOR_SELECTORS = [
  "ytd-watch-metadata #owner",
  "#above-the-fold #owner",
  "ytd-watch-metadata #description",
  "#above-the-fold ytd-watch-metadata"
];

let inlineRenderTimer = null;
let lastKnownUrl = window.location.href;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "getTranscript") {
    return false;
  }

  extractTranscriptPayload()
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function extractTranscriptPayload() {
  const playerResponse = await readPlayerResponseForCurrentVideo();
  const captionTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (!captionTracks.length) {
    throw new Error("No transcript is available for this video.");
  }

  const preferredTrack =
    captionTracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ||
    captionTracks.find((track) => track.kind !== "asr") ||
    captionTracks[0];

  if (!preferredTrack?.baseUrl) {
    throw new Error("The transcript track URL is missing.");
  }

  const pot = await getPot();
  const transcriptUrl = buildTranscriptUrl(preferredTrack.baseUrl, pot);
  const transcript = await fetchTranscriptText(transcriptUrl);

  if (!transcript) {
    throw new Error("The transcript did not contain any text.");
  }

  return {
    title: playerResponse?.videoDetails?.title || document.title || "Untitled video",
    url: window.location.href,
    transcript
  };
}

function getCurrentVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let started = false;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      started = true;
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (started && depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parsePlayerResponseFromText(text) {
  const patterns = [
    /var ytInitialPlayerResponse\s*=\s*/g,
    /window\["ytInitialPlayerResponse"\]\s*=\s*/g,
    /"ytInitialPlayerResponse"\s*:\s*/g
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const jsonText = extractBalancedJson(text, match.index + match[0].length);

      if (!jsonText) {
        continue;
      }

      try {
        return JSON.parse(jsonText);
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function fetchWatchPagePlayerResponse(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`The YouTube watch page could not be loaded (HTTP ${response.status}).`);
  }

  const html = await response.text();

  if (!html || html.trim() === "") {
    throw new Error("The YouTube watch page response was empty.");
  }

  const playerResponse = parsePlayerResponseFromText(html);

  if (playerResponse?.videoDetails?.videoId === videoId) {
    return playerResponse;
  }

  return null;
}

async function readPlayerResponseForCurrentVideo() {
  const currentVideoId = getCurrentVideoId();

  if (!currentVideoId) {
    throw new Error("Could not determine the current YouTube video.");
  }

  const global = window.ytInitialPlayerResponse;

  if (global?.videoDetails?.videoId === currentVideoId) {
    return global;
  }

  const playerResponse = await fetchWatchPagePlayerResponse(currentVideoId);

  if (playerResponse) {
    return playerResponse;
  }

  throw new Error("Could not read the YouTube player data for the current video.");
}

const CC_BUTTON_SELECTORS = [
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > div.ytp-right-controls > button.ytp-subtitles-button",
  ".ytp-subtitles-button"
];

function findCcButton() {
  for (const selector of CC_BUTTON_SELECTORS) {
    const button = document.querySelector(selector);

    if (button) {
      return button;
    }
  }

  return null;
}

async function getPot() {
  const cached = readPotFromPerformance();

  if (cached) {
    return cached;
  }

  const button = findCcButton();

  if (!button) {
    return "";
  }

  try {
    performance.clearResourceTimings();
    button.click();
    button.click();
  } catch {
    return "";
  }

  for (let index = 0; index < POT_POLL_ATTEMPTS; index += 1) {
    await sleep(POT_POLL_INTERVAL_MS);
    const pot = readPotFromPerformance();

    if (pot) {
      return pot;
    }
  }

  return "";
}

function readPotFromPerformance() {
  const entries = performance.getEntriesByType("resource");

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (!entry.name.includes("/api/timedtext")) {
      continue;
    }

    try {
      const pot = new URL(entry.name).searchParams.get("pot");

      if (pot) {
        return pot;
      }
    } catch {
      continue;
    }
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTranscriptUrl(baseUrl, pot) {
  if (pot) {
    return `${baseUrl}&pot=${encodeURIComponent(pot)}&c=WEB`;
  }

  return baseUrl;
}

async function fetchTranscriptText(transcriptUrl) {
  const response = await fetch(transcriptUrl, { credentials: "include" });

  if (!response.ok) {
    throw new Error(`The transcript could not be loaded (HTTP ${response.status}).`);
  }

  const text = await response.text();

  if (!text || text.trim() === "") {
    throw new Error("The transcript response was empty.");
  }

  return parseXmlTranscript(text);
}

function parseXmlTranscript(xmlText) {
  const lines = [];
  const pattern = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = pattern.exec(xmlText)) !== null) {
    const decoded = decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();

    if (decoded) {
      lines.push(decoded);
    }
  }

  return lines.length ? lines.join("\n") : null;
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function isWatchPage() {
  return window.location.pathname === "/watch";
}

function prettifyTarget(target) {
  if (target === "claude") {
    return "Claude";
  }

  if (target === "gemini") {
    return "Gemini";
  }

  return "ChatGPT";
}

function ensureInlineStyle() {
  if (document.getElementById(INLINE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = INLINE_STYLE_ID;
  style.textContent = `
    #${INLINE_ROOT_ID} {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 12px 0 16px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
    }

    #${INLINE_ROOT_ID} .ytta-button {
      border: 0;
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
    }

    #${INLINE_ROOT_ID} .ytta-button:disabled {
      opacity: 0.7;
      cursor: wait;
    }

    #${INLINE_ROOT_ID} .ytta-quick-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    #${INLINE_ROOT_ID} .ytta-primary {
      background: #3b82f6;
    }

    #${INLINE_ROOT_ID} .ytta-secondary {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    #${INLINE_ROOT_ID} .ytta-status {
      font-size: 13px;
      color: #93c5fd;
      line-height: 1.4;
    }

    #${INLINE_ROOT_ID} .ytta-status[data-error="true"] {
      color: #fca5a5;
    }
  `;

  document.documentElement.appendChild(style);
}

function getInlineAnchor() {
  for (const selector of INLINE_ANCHOR_SELECTORS) {
    const anchor = document.querySelector(selector);

    if (anchor) {
      return anchor;
    }
  }

  return null;
}

function createInlineRoot() {
  const root = document.createElement("div");
  root.id = INLINE_ROOT_ID;
  root.innerHTML = `
    <button class="ytta-button ytta-primary" type="button" data-role="default-send"></button>
    <div class="ytta-quick-presets" data-role="quick-presets"></div>
    <button class="ytta-button ytta-secondary" type="button" data-role="settings">Settings</button>
    <span class="ytta-status" data-role="status"></span>
  `;

  root.querySelector('[data-role="default-send"]').addEventListener("click", () => {
    void handleInlineSend(root);
  });

  root.querySelector('[data-role="settings"]').addEventListener("click", () => {
    window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener,noreferrer");
  });

  return root;
}

function setInlineStatus(root, message, isError = false) {
  const status = root.querySelector('[data-role="status"]');
  status.textContent = message;
  status.dataset.error = isError ? "true" : "false";
}

async function renderInlineActions() {
  if (!isWatchPage()) {
    document.getElementById(INLINE_ROOT_ID)?.remove();
    return;
  }

  const anchor = getInlineAnchor();

  if (!anchor) {
    return;
  }

  ensureInlineStyle();

  let settings;
  try {
    settings = normalizeSettings(await chrome.storage.sync.get(null));
  } catch (error) {
    if (isContextInvalidated(error)) {
      document.getElementById(INLINE_ROOT_ID)?.remove();
      return;
    }
    throw error;
  }
  const targetLabel = prettifyTarget(settings.target);
  const root = document.getElementById(INLINE_ROOT_ID) || createInlineRoot();
  const sendButton = root.querySelector('[data-role="default-send"]');
  const quickPresetContainer = root.querySelector('[data-role="quick-presets"]');

  if (anchor.id === "owner") {
    if (anchor.nextElementSibling !== root) {
      anchor.insertAdjacentElement("afterend", root);
    }
  } else if (!root.parentElement || root.parentElement !== anchor) {
    anchor.prepend(root);
  }

  sendButton.textContent = `${getPromptPresetLabel(settings.defaultPreset)} -> ${targetLabel}`;
  quickPresetContainer.innerHTML = "";

  for (const preset of getQuickPresetDefinitions()) {
    if (preset.id === settings.defaultPreset) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ytta-button ytta-secondary";
    button.textContent = preset.label;
    button.addEventListener("click", () => {
      void handleInlineSend(root, preset.id);
    });
    quickPresetContainer.appendChild(button);
  }

  if (!root.dataset.busy && !root.dataset.holdStatus) {
    setInlineStatus(
      root,
      `Default preset: ${getPromptPresetLabel(settings.defaultPreset)}. Target: ${targetLabel}.`
    );
  }
}

function isContextInvalidated(error) {
  return error?.message?.includes("Extension context invalidated");
}

function scheduleInlineRender() {
  if (inlineRenderTimer) {
    clearTimeout(inlineRenderTimer);
  }

  inlineRenderTimer = window.setTimeout(() => {
    inlineRenderTimer = null;
    renderInlineActions().catch((error) => {
      if (isContextInvalidated(error)) {
        document.getElementById(INLINE_ROOT_ID)?.remove();
        return;
      }
      console.error("[YouTube Transcript to AI]", error);
    });
  }, INLINE_RENDER_DELAY_MS);
}

async function handleInlineSend(root, presetId = null) {
  const buttons = root.querySelectorAll(".ytta-button");

  root.dataset.busy = "true";
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const settings = normalizeSettings(await chrome.storage.sync.get(null));
    const resolvedPresetId = presetId || settings.defaultPreset;

    setInlineStatus(root, `Collecting transcript for ${getPromptPresetLabel(resolvedPresetId)}...`);

    const response = await chrome.runtime.sendMessage({
      type: "sendTranscriptToAi",
      presetId: resolvedPresetId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The transcript could not be sent.");
    }

    setInlineStatus(
      root,
      `${getPromptPresetLabel(response.presetId || resolvedPresetId)} opened in ${prettifyTarget(response.target)}.`
    );
  } catch (error) {
    if (isContextInvalidated(error)) {
      // Extension was reloaded while this content script was alive; remove stale UI.
      document.getElementById(INLINE_ROOT_ID)?.remove();
      return;
    }
    console.error("[YouTube Transcript to AI]", error);
    setInlineStatus(root, error.message || "Something went wrong.", true);
  } finally {
    // Skip DOM/Chrome work if context was invalidated (root already removed).
    if (document.getElementById("ytta-inline-root")) {
      delete root.dataset.busy;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      root.dataset.holdStatus = "true";
      window.setTimeout(() => {
        delete root.dataset.holdStatus;
        scheduleInlineRender();
      }, STATUS_HOLD_MS);
    }
  }
}

function handlePotentialNavigationChange() {
  if (lastKnownUrl !== window.location.href) {
    lastKnownUrl = window.location.href;
  }

  scheduleInlineRender();
}

function startInlineUi() {
  scheduleInlineRender();

  const observer = new MutationObserver(() => {
    handlePotentialNavigationChange();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", scheduleInlineRender);
  window.addEventListener("yt-page-data-updated", scheduleInlineRender);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (
      changes.target ||
      changes.openMode ||
      changes.autoSubmit ||
      changes.promptTemplate ||
      changes.defaultPreset
    ) {
      scheduleInlineRender();
    }
  });
}

startInlineUi();
