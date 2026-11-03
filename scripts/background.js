importScripts("prompt-presets.js", "history-store.js", "prompt-delivery.js", "playback-utils.js", "sponsor-service.js");

const { DEFAULT_SETTINGS, normalizeSettings, resolvePromptTemplate } = globalThis.YTTA_PROMPTS;
const { sanitizeHistory, upsertHistoryEntry } = globalThis.YTTA_HISTORY;

const AI_TARGETS = {
  chatgpt: {
    url: "https://chatgpt.com/",
    matchPatterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  },
  claude: {
    url: "https://claude.ai/new",
    matchPatterns: ["https://claude.ai/*"]
  },
  gemini: {
    url: "https://gemini.google.com/app",
    matchPatterns: ["https://gemini.google.com/*"]
  }
};

const { PREFIX, RESULT_PREFIX, TTL_MS, isPendingKey, isExpired } = YTTA_DELIVERY;
let allocationChain = Promise.resolve();
const HISTORY_KEY = "transcriptHistory";
const DEBUG_PREFIX = "[YTTA][Background]";

function formatDebugError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null
  };
}

function debugLog(step, details = null) {
  console.log(DEBUG_PREFIX, step, details || "");
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  const settings = normalizeSettings(stored);

  if (!stored.defaultPreset && typeof stored.promptTemplate === "string" && stored.promptTemplate.trim()) {
    settings.defaultPreset = "custom";
  }

  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...settings });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("message received", {
    type: message?.type,
    requestId: message?.requestId || null,
    senderTabId: sender.tab?.id || null,
    senderUrl: sender.tab?.url || null
  });

  if (message?.type === "getCurrentTabId") {
    sendResponse({ ok: true, tabId: sender.tab?.id || null });
    return false;
  }
  if (message?.type === "getSponsorSegments") {
    if (!sender.tab?.url?.startsWith("https://www.youtube.com/")) {
      sendResponse({ ok: false, error: "SponsorBlock lookups are only available on YouTube." });
      return false;
    }
    YTTA_SPONSORS.getSegments(message.videoId)
      .then((segments) => sendResponse({ ok: true, segments }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "resendTranscript") {
    handleResendTranscript(message.entry, message.presetId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "compareTranscripts") {
    handleCompareTranscripts(message.entries, message.presetId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "sendTranscriptToAi") {
    return false;
  }

  const tab = message.tab || normalizeSenderTab(sender.tab);

  handleSendTranscript(tab, message.presetId, message.requestId)
    .then((result) => {
      debugLog("sendTranscriptToAi success", {
        requestId: message.requestId || null,
        result
      });
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      debugLog("sendTranscriptToAi failed", {
        requestId: message.requestId || null,
        error: formatDebugError(error)
      });
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

function normalizeSenderTab(tab) {
  if (!tab?.id || !tab?.url) {
    return null;
  }

  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url
  };
}

async function handleSendTranscript(tab, requestedPresetId, requestId = crypto.randomUUID()) {
  if (!tab?.url || !tab?.id) {
    throw new Error("No active YouTube tab was found.");
  }

  debugLog("handleSendTranscript start", {
    requestId,
    tabId: tab.id,
    tabUrl: tab.url,
    requestedPresetId
  });
  const settings = normalizeSettings(await chrome.storage.sync.get(null));
  debugLog("settings loaded", {
    requestId,
    target: settings.target,
    openMode: settings.openMode,
    reuseExistingChat: settings.reuseExistingChat,
    autoSubmit: settings.autoSubmit
  });

  let response;
  try {
    debugLog("requesting transcript from YouTube tab", { requestId, tabId: tab.id });
    response = await chrome.tabs.sendMessage(tab.id, { type: "getTranscript", requestId });
  } catch (error) {
    debugLog("could not message YouTube tab", { requestId, error: formatDebugError(error) });
    throw new Error("Could not reach the YouTube page. Try refreshing the video tab.");
  }

  debugLog("transcript response received", {
    requestId,
    ok: Boolean(response?.ok),
    error: response?.error || null,
    transcriptLength: response?.payload?.transcript?.length || 0
  });

  if (!response?.ok) {
    throw new Error(response?.error || "The transcript could not be retrieved.");
  }

  const presetId = requestedPresetId || settings.defaultPreset;
  const prompt = buildPrompt(resolvePromptTemplate(settings, presetId), response.payload);
  debugLog("prompt built", { requestId, presetId, promptLength: prompt.length });

  await saveTranscriptToHistory(response.payload, presetId);
  const delivery = await dispatchPrompt(prompt, settings, requestId);

  return {
    target: settings.target,
    presetId,
    delivery
  };
}

async function handleResendTranscript(entry, requestedPresetId) {
  if (!isUsableEntry(entry)) {
    throw new Error("This saved transcript is missing its text.");
  }

  const settings = normalizeSettings(await chrome.storage.sync.get(null));
  const presetId = requestedPresetId || entry.presetId || settings.defaultPreset;
  const payload = { title: entry.title, url: entry.url, transcript: entry.transcript };
  const prompt = buildPrompt(resolvePromptTemplate(settings, presetId), payload);

  const delivery = await dispatchPrompt(prompt, settings, crypto.randomUUID());

  return { target: settings.target, presetId, delivery };
}

async function handleCompareTranscripts(entries, requestedPresetId) {
  const usable = Array.isArray(entries) ? entries.filter(isUsableEntry) : [];

  if (usable.length !== 2) {
    throw new Error("Pick exactly two saved transcripts to compare.");
  }

  const settings = normalizeSettings(await chrome.storage.sync.get(null));
  const prompt = buildComparePrompt(usable);

  const delivery = await dispatchPrompt(prompt, settings, crypto.randomUUID());

  return { target: settings.target, delivery };
}

function isUsableEntry(entry) {
  return Boolean(
    entry &&
      typeof entry.transcript === "string" &&
      entry.transcript.trim() &&
      typeof entry.url === "string"
  );
}

function buildComparePrompt(entries) {
  const header = [
    "Compare and contrast the two YouTube video transcripts below.",
    "",
    "Requirements:",
    "- Summarize each video briefly",
    "- Highlight the main points of agreement and disagreement",
    "- Call out unique ideas that appear in only one video",
    "- Finish with the most important combined takeaways"
  ].join("\n");
  const sections = entries.map((entry, index) => {
    const label = String.fromCharCode(65 + index);
    const title = entry.title || "Untitled video";
    return [`## Video ${label}: ${title}`, `URL: ${entry.url}`, "", entry.transcript].join("\n");
  });

  return [header, "", ...sections].join("\n\n");
}

async function saveTranscriptToHistory(payload, presetId) {
  if (!isUsableEntry(payload)) {
    return;
  }

  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const nextHistory = upsertHistoryEntry(
      sanitizeHistory(stored[HISTORY_KEY]),
      { title: payload.title || "", url: payload.url, transcript: payload.transcript },
      presetId
    );
    await chrome.storage.local.set({ [HISTORY_KEY]: nextHistory });
  } catch (error) {
    debugLog("failed to save transcript history", { error: formatDebugError(error) });
  }
}

async function dispatchPrompt(prompt, settings, requestId) {
  // Only allocation is serialized. Delivery to separate tabs can run in parallel.
  const allocation = allocationChain.then(async () => {
    await cleanupExpiredPrompts();
    const aiSurface = await openAiSurface(settings.target, settings.openMode, settings.reuseExistingChat);
    if (!Number.isInteger(aiSurface?.tabId)) throw new Error("Could not identify the destination AI tab.");
    const expiresAt = Date.now() + TTL_MS;
    await chrome.storage.local.set({
      [`${PREFIX}${requestId}`]: {
        id: requestId, target: settings.target, targetTabId: aiSurface.tabId,
        autoSubmit: Boolean(settings.autoSubmit), prompt, expiresAt
      }
    });
    return expiresAt;
  });
  allocationChain = allocation.catch(() => {});
  const expiresAt = await allocation;
  return waitForDelivery(requestId, expiresAt);
}

async function cleanupExpiredPrompts() {
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter((key) => key === "pendingPrompt" ||
    (isPendingKey(key) && isExpired(stored[key])) ||
    (key.startsWith(RESULT_PREFIX) && isExpired(stored[key])));
  if (keys.length) await chrome.storage.local.remove(keys);
}

function waitForDelivery(id, expiresAt) {
  const resultKey = `${RESULT_PREFIX}${id}`;
  const pendingKey = `${PREFIX}${id}`;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = async (result, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChanged);
      await chrome.storage.local.remove([pendingKey, resultKey]).catch(() => {});
      if (error || !result?.ok) reject(error || new Error(result?.error || "Prompt insertion failed."));
      else resolve(result);
    };
    const onChanged = (changes, area) => {
      if (area === "local" && changes[resultKey]?.newValue) void finish(changes[resultKey].newValue);
    };
    const timer = setTimeout(() => {
      void finish(null, new Error("The AI composer was not ready in time. Sign in or finish loading the page, then resend the saved transcript."));
    }, Math.max(0, expiresAt - Date.now()));
    chrome.storage.onChanged.addListener(onChanged);
    void chrome.storage.local.get(resultKey).then((stored) => {
      if (stored[resultKey]) void finish(stored[resultKey]);
    }).catch((error) => { void finish(null, error); });
  });
}

async function openAiSurface(target, openMode, reuseExistingChat) {
  const aiTarget = AI_TARGETS[target];

  if (!aiTarget) {
    throw new Error("Unsupported AI target configured.");
  }

  debugLog("openAiSurface", { target, openMode, reuseExistingChat });

  if (reuseExistingChat) {
    const existingTab = await findExistingAiTab(aiTarget.matchPatterns);

    if (existingTab?.id) {
      debugLog("reusing existing AI tab", {
        target,
        tabId: existingTab.id,
        url: existingTab.url
      });
      await chrome.tabs.update(existingTab.id, { active: true });

      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }

      return {
        tabId: existingTab.id
      };
    }
  }

  if (openMode === "new-window") {
    const createdWindow = await chrome.windows.create({
      url: aiTarget.url,
      focused: true,
      type: "popup",
      width: 1200,
      height: 900
    });

    debugLog("created AI window", {
      target,
      tabId: createdWindow.tabs?.[0]?.id || null,
      windowId: createdWindow.id || null
    });
    return {
      tabId: createdWindow.tabs?.[0]?.id || null
    };
  }

  const createdTab = await chrome.tabs.create({
    url: aiTarget.url,
    active: true
  });

  debugLog("created AI tab", { target, tabId: createdTab.id || null });
  return {
    tabId: createdTab.id || null
  };
}

async function findExistingAiTab(matchPatterns) {
  const tabs = await chrome.tabs.query({ url: matchPatterns });
  const stored = await chrome.storage.local.get(null);
  for (const tab of [...tabs].sort((a, b) => Number(b.active) - Number(a.active))) {
    const reserved = Object.entries(stored).some(([key, value]) => isPendingKey(key) &&
      !isExpired(value) && value.targetTabId === tab.id);
    if (reserved) continue;
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: "getComposerState" });
      if (state?.ready && !state.hasDraft && !state.busy) return tab;
    } catch { /* An unavailable composer is not safe to reuse. */ }
  }
  return null;
}

function buildPrompt(template, payload) {
  return template.replace(/\{\{(title|url|transcript)\}\}/g, (_match, key) => String(payload[key] || ""));
}
