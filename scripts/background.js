importScripts("prompt-presets.js");

const { DEFAULT_SETTINGS, normalizeSettings, resolvePromptTemplate } = globalThis.YTTA_PROMPTS;

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

const PENDING_PROMPT_KEY = "pendingPrompt";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  const settings = normalizeSettings(stored);

  if (!stored.defaultPreset && typeof stored.promptTemplate === "string" && stored.promptTemplate.trim()) {
    settings.defaultPreset = "custom";
  }

  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...settings });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "getCurrentTabId") {
    sendResponse({ ok: true, tabId: sender.tab?.id || null });
    return false;
  }

  if (message?.type !== "sendTranscriptToAi") {
    return false;
  }

  const tab = message.tab || normalizeSenderTab(sender.tab);

  handleSendTranscript(tab, message.presetId)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

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

async function handleSendTranscript(tab, requestedPresetId) {
  if (!tab?.url || !tab?.id) {
    throw new Error("No active YouTube tab was found.");
  }

  const settings = normalizeSettings(await chrome.storage.sync.get(null));

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "getTranscript" });
  } catch {
    throw new Error("Could not reach the YouTube page. Try refreshing the video tab.");
  }

  if (!response?.ok) {
    throw new Error(response?.error || "The transcript could not be retrieved.");
  }

  const presetId = requestedPresetId || settings.defaultPreset;
  const prompt = buildPrompt(resolvePromptTemplate(settings, presetId), response.payload);
  const aiSurface = await openAiSurface(settings.target, settings.openMode, settings.reuseExistingChat);

  await chrome.storage.local.set({
    [PENDING_PROMPT_KEY]: {
      id: crypto.randomUUID(),
      target: settings.target,
      targetTabId: aiSurface?.tabId || null,
      autoSubmit: Boolean(settings.autoSubmit),
      prompt
    }
  });

  return {
    target: settings.target,
    presetId
  };
}

async function openAiSurface(target, openMode, reuseExistingChat) {
  const aiTarget = AI_TARGETS[target];

  if (!aiTarget) {
    throw new Error("Unsupported AI target configured.");
  }

  if (reuseExistingChat) {
    const existingTab = await findExistingAiTab(aiTarget.matchPatterns);

    if (existingTab?.id) {
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

    return {
      tabId: createdWindow.tabs?.[0]?.id || null
    };
  }

  const createdTab = await chrome.tabs.create({
    url: aiTarget.url,
    active: true
  });

  return {
    tabId: createdTab.id || null
  };
}

async function findExistingAiTab(matchPatterns) {
  const tabs = await chrome.tabs.query({ url: matchPatterns });

  if (!tabs.length) {
    return null;
  }

  return tabs.find((tab) => tab.active) || tabs[0];
}

function buildPrompt(template, payload) {
  return template
    .replaceAll("{{title}}", payload.title)
    .replaceAll("{{url}}", payload.url)
    .replaceAll("{{transcript}}", payload.transcript);
}
