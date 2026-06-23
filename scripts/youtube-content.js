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
const INLINE_READY_DELAY_MS = 1200;
const INLINE_TRANSCRIPT_RETRY_MS = 600;
const INLINE_TRANSCRIPT_MAX_WAIT_MS = 10000;
const STATUS_HOLD_MS = 4000;
const DEBUG_PREFIX = "[YTTA][YouTube]";
const DEBUG_ENTRY_LIMIT = 80;
const INLINE_ANCHOR_SELECTORS = [
  "ytd-watch-metadata #owner",
  "#above-the-fold #owner",
  "ytd-watch-metadata #description",
  "#above-the-fold ytd-watch-metadata"
];

let inlineRenderTimer = null;
let inlineReadyTimer = null;
let inlineTranscriptRetryTimer = null;
let inlineTranscriptReadiness = null;
let inlineIsLoading = false;
let lastKnownUrl = window.location.href;
const debugEntries = [];

function formatDebugDetails(details) {
  if (!details) {
    return "";
  }

  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack
    };
  }

  return details;
}

function debugLog(step, details = null) {
  const entry = {
    at: new Date().toISOString(),
    step,
    details: formatDebugDetails(details)
  };

  debugEntries.push(entry);

  if (debugEntries.length > DEBUG_ENTRY_LIMIT) {
    debugEntries.shift();
  }

  globalThis.YTTA_DEBUG_LOG = debugEntries;
  console.log(DEBUG_PREFIX, step, entry.details);
}

if (hasExtensionContext()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "getTranscript") {
      return false;
    }

    debugLog("getTranscript message received", {
      requestId: message.requestId,
      videoId: getCurrentVideoId(),
      url: window.location.href
    });

    extractTranscriptPayload()
      .then((payload) => {
        debugLog("getTranscript success", {
          requestId: message.requestId,
          title: payload.title,
          transcriptLength: payload.transcript.length
        });
        sendResponse({ ok: true, payload });
      })
      .catch((error) => {
        debugLog("getTranscript failed", {
          requestId: message.requestId,
          error: formatDebugDetails(error)
        });
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  });
}

async function extractTranscriptPayload() {
  debugLog("extractTranscriptPayload start", { videoId: getCurrentVideoId() });
  const playerResponse = await readPlayerResponseForCurrentVideo();
  const captionTracks = getCaptionTracks(playerResponse);
  const preferredTrack = findPreferredCaptionTrack(playerResponse);

  debugLog("player response ready", {
    videoId: playerResponse?.videoDetails?.videoId,
    captionTrackCount: captionTracks.length,
    preferredLanguage: preferredTrack?.languageCode || null,
    preferredKind: preferredTrack?.kind || null,
    hasBaseUrl: Boolean(preferredTrack?.baseUrl)
  });

  if (!preferredTrack) {
    throw new Error("No transcript is available for this video.");
  }

  if (!preferredTrack?.baseUrl) {
    throw new Error("The transcript track URL is missing.");
  }

  const pot = await getPot();
  debugLog("pot lookup finished", { hasPot: Boolean(pot) });
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

function getCaptionTracks(playerResponse) {
  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function findPreferredCaptionTrack(playerResponse) {
  const captionTracks = getCaptionTracks(playerResponse);

  return (
    captionTracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ||
    captionTracks.find((track) => track.kind !== "asr") ||
    captionTracks[0] ||
    null
  );
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
  debugLog("fetch watch page player response", { videoId });
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
    debugLog("watch page player response parsed", { videoId });
    return playerResponse;
  }

  debugLog("watch page player response did not match current video", {
    requestedVideoId: videoId,
    parsedVideoId: playerResponse?.videoDetails?.videoId || null
  });
  return null;
}

async function readPlayerResponseForCurrentVideo() {
  const currentVideoId = getCurrentVideoId();

  if (!currentVideoId) {
    throw new Error("Could not determine the current YouTube video.");
  }

  const global = window.ytInitialPlayerResponse;

  if (global?.videoDetails?.videoId === currentVideoId) {
    debugLog("using window.ytInitialPlayerResponse", { videoId: currentVideoId });
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

function hasExtensionContext() {
  try {
    return Boolean(globalThis.chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function teardownInlineUi() {
  if (inlineRenderTimer) {
    clearTimeout(inlineRenderTimer);
    inlineRenderTimer = null;
  }

  if (inlineTranscriptRetryTimer) {
    clearTimeout(inlineTranscriptRetryTimer);
    inlineTranscriptRetryTimer = null;
  }

  document.getElementById(INLINE_ROOT_ID)?.remove();
  document.getElementById(INLINE_STYLE_ID)?.remove();
}

function resetInlineTranscriptReadiness() {
  inlineTranscriptReadiness = null;

  if (inlineTranscriptRetryTimer) {
    clearTimeout(inlineTranscriptRetryTimer);
    inlineTranscriptRetryTimer = null;
  }
}

function getInlineActionButtons(root) {
  return root.querySelectorAll(".ytta-button:not([data-role='settings']):not([data-role='debug'])");
}

function setInlineActionButtonsDisabled(root, disabled) {
  getInlineActionButtons(root).forEach((button) => {
    button.disabled = disabled;
  });
}

function startInlineLoadingState() {
  inlineIsLoading = true;
  resetInlineTranscriptReadiness();

  if (inlineReadyTimer) {
    clearTimeout(inlineReadyTimer);
  }

  inlineReadyTimer = window.setTimeout(() => {
    inlineReadyTimer = null;
    inlineIsLoading = false;
    scheduleInlineRender();
  }, INLINE_READY_DELAY_MS);
}

function markInlineUiLoading(root) {
  delete root.dataset.holdStatus;
  delete root.dataset.busy;
  root.dataset.loading = "true";
  setInlineActionButtonsDisabled(root, true);
  const sendButton = root.querySelector('[data-role="default-send"]');

  if (sendButton) {
    sendButton.textContent = "Preparing...";
  }

  setInlineStatus(root, "Loading video details... buttons will be ready in a moment.");
}

function markInlineUiNotReady(root, message, isError = false) {
  delete root.dataset.busy;
  if (isError) {
    delete root.dataset.loading;
  } else {
    root.dataset.loading = "true";
  }
  setInlineActionButtonsDisabled(root, true);
  setInlineStatus(root, message, isError);
}

function scheduleTranscriptReadinessRetry(videoId) {
  if (inlineTranscriptRetryTimer) {
    return;
  }

  debugLog("schedule transcript readiness retry", { videoId });
  inlineTranscriptRetryTimer = window.setTimeout(() => {
    inlineTranscriptRetryTimer = null;

    if (inlineTranscriptReadiness?.videoId !== videoId) {
      return;
    }

    scheduleInlineRender(0);
  }, INLINE_TRANSCRIPT_RETRY_MS);
}

async function checkInlineTranscriptReadiness(videoId, startedAt) {
  debugLog("check transcript readiness", { videoId });

  try {
    const playerResponse = await readPlayerResponseForCurrentVideo();

    if (getCurrentVideoId() !== videoId) {
      debugLog("readiness video changed while checking", {
        expectedVideoId: videoId,
        currentVideoId: getCurrentVideoId()
      });
      return {
        status: "checking",
        ready: false,
        pending: true,
        message: "Loading the current video..."
      };
    }

    const preferredTrack = findPreferredCaptionTrack(playerResponse);

    if (!preferredTrack) {
      debugLog("readiness unavailable: no caption tracks", {
        videoId,
        captionTrackCount: getCaptionTracks(playerResponse).length
      });
      return {
        status: "unavailable",
        ready: false,
        pending: false,
        isError: true,
        message: "No transcript is available for this video."
      };
    }

    if (!preferredTrack.baseUrl) {
      debugLog("readiness unavailable: missing baseUrl", {
        videoId,
        languageCode: preferredTrack.languageCode || null,
        kind: preferredTrack.kind || null
      });
      return {
        status: "unavailable",
        ready: false,
        pending: false,
        isError: true,
        message: "The transcript track URL is missing for this video."
      };
    }

    debugLog("readiness ready", {
      videoId,
      languageCode: preferredTrack.languageCode || null,
      kind: preferredTrack.kind || null
    });
    return {
      status: "ready",
      ready: true,
      pending: false,
      message: "Transcript ready."
    };
  } catch (error) {
    const canRetry = Date.now() - startedAt < INLINE_TRANSCRIPT_MAX_WAIT_MS;

    debugLog("readiness check failed", {
      videoId,
      canRetry,
      error: formatDebugDetails(error)
    });

    return {
      status: canRetry ? "checking" : "unavailable",
      ready: false,
      pending: canRetry,
      isError: !canRetry,
      message: canRetry
        ? "Waiting for YouTube video data..."
        : error.message || "The transcript could not be checked."
    };
  }
}

async function getInlineTranscriptReadiness() {
  const videoId = getCurrentVideoId();

  if (!videoId) {
    return {
      ready: false,
      pending: false,
      isError: true,
      message: "Could not determine the current YouTube video."
    };
  }

  if (inlineTranscriptReadiness?.videoId !== videoId) {
    debugLog("start transcript readiness state", { videoId });
    inlineTranscriptReadiness = {
      videoId,
      status: "checking",
      startedAt: Date.now(),
      promise: null,
      message: "Checking transcript availability..."
    };
  }

  if (inlineTranscriptReadiness.status === "ready") {
    return {
      ready: true,
      pending: false,
      message: "Transcript ready."
    };
  }

  if (inlineTranscriptReadiness.status === "unavailable") {
    return {
      ready: false,
      pending: false,
      isError: true,
      message: inlineTranscriptReadiness.message
    };
  }

  if (!inlineTranscriptReadiness.promise) {
    const state = inlineTranscriptReadiness;

    state.promise = checkInlineTranscriptReadiness(state.videoId, state.startedAt).then((result) => {
      if (inlineTranscriptReadiness?.videoId === state.videoId) {
        inlineTranscriptReadiness = {
          ...state,
          ...result,
          promise: null
        };

        if (result.pending) {
          scheduleTranscriptReadinessRetry(state.videoId);
        }
      }

      return result;
    });
  }

  return inlineTranscriptReadiness.promise;
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
      transition: box-shadow 120ms ease, opacity 120ms ease, transform 120ms ease;
    }

    #${INLINE_ROOT_ID} .ytta-button:disabled {
      opacity: 0.7;
      cursor: wait;
    }

    #${INLINE_ROOT_ID} .ytta-button:active,
    #${INLINE_ROOT_ID} .ytta-button.ytta-pressed {
      box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.75);
      opacity: 0.86;
      transform: translateY(1px) scale(0.98);
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
    <button class="ytta-button ytta-secondary" type="button" data-role="debug">Debug</button>
    <span class="ytta-status" data-role="status"></span>
  `;

  root.addEventListener(
    "pointerdown",
    (event) => {
      const button = event.target.closest(".ytta-button");

      if (!button || !root.contains(button)) {
        return;
      }

      flashInlineButtonPress(button);
      debugLog("inline button pointerdown", {
        role: button.dataset.role || null,
        disabled: button.disabled,
        videoId: getCurrentVideoId()
      });

      if (button.dataset.role !== "debug") {
        setInlineStatus(root, `Press detected: ${button.textContent.trim() || button.dataset.role}`);
      }
    },
    true
  );

  root.querySelector('[data-role="default-send"]').addEventListener("click", () => {
    debugLog("default inline button clicked", {
      disabled: root.querySelector('[data-role="default-send"]')?.disabled || false,
      videoId: getCurrentVideoId()
    });
    void handleInlineSend(root);
  });

  root.querySelector('[data-role="settings"]').addEventListener("click", () => {
    debugLog("settings button clicked");

    if (!hasExtensionContext()) {
      teardownInlineUi();
      return;
    }

    try {
      window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener,noreferrer");
    } catch (error) {
      if (isContextInvalidated(error)) {
        teardownInlineUi();
      } else {
        throw error;
      }
    }
  });

  root.querySelector('[data-role="debug"]').addEventListener("click", () => {
    dumpInlineDebugLog(root);
  });

  return root;
}

function flashInlineButtonPress(button) {
  button.classList.remove("ytta-pressed");
  void button.offsetWidth;
  button.classList.add("ytta-pressed");

  window.setTimeout(() => {
    button.classList.remove("ytta-pressed");
  }, 180);
}

function dumpInlineDebugLog(root) {
  debugLog("debug button clicked", {
    videoId: getCurrentVideoId(),
    url: window.location.href,
    entries: debugEntries.length
  });

  console.group("[YTTA] Inline debug log");
  console.table(debugEntries);
  console.log("Current readiness:", inlineTranscriptReadiness);
  console.log("Current URL:", window.location.href);
  console.groupEnd();
  setInlineStatus(root, "Debug log printed in this YouTube tab's DevTools console.");
}

function mountInlineRoot(anchor, root) {
  if (anchor.id === "owner") {
    if (anchor.nextElementSibling !== root) {
      anchor.insertAdjacentElement("afterend", root);
    }
    return;
  }

  if (!root.parentElement || root.parentElement !== anchor) {
    anchor.prepend(root);
  }
}

function setInlineStatus(root, message, isError = false) {
  const status = root.querySelector('[data-role="status"]');
  status.textContent = message;
  status.dataset.error = isError ? "true" : "false";
  debugLog("inline status", { message, isError });
}

async function renderInlineActions() {
  if (!hasExtensionContext()) {
    teardownInlineUi();
    return;
  }

  if (!isWatchPage()) {
    teardownInlineUi();
    return;
  }

  const anchor = getInlineAnchor();

  if (!anchor) {
    // Watch-metadata anchor isn't in the DOM yet. Don't rely solely on the
    // MutationObserver / readyTimer firing again after it appears — on SPA
    // navigation the anchor can materialize during a quiet gap, leaving the
    // button unmounted until a full reload. Poll until it shows up.
    debugLog("inline anchor missing, scheduling retry", { videoId: getCurrentVideoId() });
    scheduleInlineRender(INLINE_TRANSCRIPT_RETRY_MS);
    return;
  }

  ensureInlineStyle();
  const root = document.getElementById(INLINE_ROOT_ID) || createInlineRoot();
  mountInlineRoot(anchor, root);

  // Show loading state immediately and bail out — a separate timer (inlineReadyTimer)
  // will flip inlineIsLoading to false and trigger the final ready render.
  if (inlineIsLoading) {
    markInlineUiLoading(root);
    return;
  }

  let settings;
  try {
    settings = normalizeSettings(await chrome.storage.sync.get(null));
  } catch (error) {
    if (isContextInvalidated(error)) {
      teardownInlineUi();
      return;
    }
    throw error;
  }

  // Re-check after the async gap — a navigation may have started loading again.
  if (inlineIsLoading) {
    markInlineUiLoading(root);
    return;
  }

  const targetLabel = prettifyTarget(settings.target);
  const sendButton = root.querySelector('[data-role="default-send"]');
  const quickPresetContainer = root.querySelector('[data-role="quick-presets"]');

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
      debugLog("quick preset button clicked", {
        presetId: preset.id,
        videoId: getCurrentVideoId()
      });
      void handleInlineSend(root, preset.id);
    });
    quickPresetContainer.appendChild(button);
  }

  const readiness = await getInlineTranscriptReadiness();

  if (!readiness.ready) {
    markInlineUiNotReady(
      root,
      readiness.message || "Checking transcript availability...",
      Boolean(readiness.isError)
    );
    return;
  }

  delete root.dataset.loading;
  setInlineActionButtonsDisabled(root, false);

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

function scheduleInlineRender(delayMs = INLINE_RENDER_DELAY_MS) {
  if (inlineRenderTimer) {
    clearTimeout(inlineRenderTimer);
  }

  inlineRenderTimer = window.setTimeout(() => {
    inlineRenderTimer = null;

    if (!hasExtensionContext()) {
      teardownInlineUi();
      return;
    }

    renderInlineActions().catch((error) => {
      if (isContextInvalidated(error)) {
        teardownInlineUi();
        return;
      }
      console.error("[YouTube Transcript to AI]", error);
    });
  }, delayMs);
}

async function handleInlineSend(root, presetId = null) {
  if (!hasExtensionContext()) {
    teardownInlineUi();
    return;
  }

  const requestId = crypto.randomUUID();
  const buttons = root.querySelectorAll(".ytta-button");

  debugLog("handleInlineSend start", {
    requestId,
    presetId,
    videoId: getCurrentVideoId(),
    url: window.location.href
  });
  root.dataset.busy = "true";
  buttons.forEach((button) => {
    if (button.dataset.role !== "debug") {
      button.disabled = true;
    }
  });

  try {
    const settings = normalizeSettings(await chrome.storage.sync.get(null));
    const resolvedPresetId = presetId || settings.defaultPreset;

    debugLog("settings loaded for send", {
      requestId,
      target: settings.target,
      openMode: settings.openMode,
      reuseExistingChat: settings.reuseExistingChat,
      autoSubmit: settings.autoSubmit,
      resolvedPresetId
    });
    setInlineStatus(root, `Collecting transcript for ${getPromptPresetLabel(resolvedPresetId)}...`);

    const response = await chrome.runtime.sendMessage({
      type: "sendTranscriptToAi",
      presetId: resolvedPresetId,
      requestId
    });

    debugLog("sendTranscriptToAi response", { requestId, response });

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
      teardownInlineUi();
      return;
    }
    debugLog("handleInlineSend failed", { requestId, error: formatDebugDetails(error) });
    console.error("[YouTube Transcript to AI]", error);
    setInlineStatus(root, error.message || "Something went wrong.", true);
  } finally {
    // Skip DOM/Chrome work if context was invalidated (root already removed).
    if (document.getElementById(INLINE_ROOT_ID)) {
      delete root.dataset.busy;
      buttons.forEach((button) => {
        if (button.dataset.role !== "debug") {
          button.disabled = false;
        }
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
    startInlineLoadingState();
    const root = document.getElementById(INLINE_ROOT_ID);

    if (root) {
      markInlineUiLoading(root);
    }
  }

  scheduleInlineRender();
}

function startInlineUi() {
  if (!hasExtensionContext()) {
    teardownInlineUi();
    return;
  }

  startInlineLoadingState();
  scheduleInlineRender();

  const observer = new MutationObserver(() => {
    handlePotentialNavigationChange();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("yt-navigate-finish", handlePotentialNavigationChange);
  window.addEventListener("yt-page-data-updated", handlePotentialNavigationChange);

  if (hasExtensionContext()) {
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
}

startInlineUi();
