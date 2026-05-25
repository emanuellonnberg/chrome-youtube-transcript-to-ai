const DEFAULT_SETTINGS = {
  target: "chatgpt",
  openMode: "new-tab",
  autoSubmit: false,
  promptTemplate: [
    "Please work with the following YouTube transcript.",
    "Video title: {{title}}",
    "Video URL: {{url}}",
    "",
    "{{transcript}}"
  ].join("\n")
};

const AI_TARGETS = {
  chatgpt: {
    url: "https://chatgpt.com/"
  },
  claude: {
    url: "https://claude.ai/new"
  }
};

const PENDING_PROMPT_KEY = "pendingPrompt";

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...settings });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "sendTranscriptToAi") {
    return false;
  }

  handleSendTranscript(message.tab)
    .then((target) => sendResponse({ ok: true, target }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleSendTranscript(tab) {
  if (!tab?.url || !tab?.id) {
    throw new Error("No active YouTube tab was found.");
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  // Delegate transcript extraction to the content script running in the YouTube tab.
  // It has DOM access and sends fetch() requests with the user's cookies + pot token.
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "getTranscript" });
  } catch {
    throw new Error(
      "Could not reach the YouTube page. Try refreshing the video tab and trying again."
    );
  }

  if (!response?.ok) {
    throw new Error(response?.error || "The transcript could not be retrieved.");
  }

  const transcriptPayload = response.payload;
  const prompt = buildPrompt(settings.promptTemplate, transcriptPayload);

  await chrome.storage.local.set({
    [PENDING_PROMPT_KEY]: {
      id: crypto.randomUUID(),
      target: settings.target,
      autoSubmit: Boolean(settings.autoSubmit),
      prompt
    }
  });

  await openAiSurface(settings.target, settings.openMode);
  return settings.target;
}

async function openAiSurface(target, openMode) {
  const aiTarget = AI_TARGETS[target];

  if (!aiTarget) {
    throw new Error("Unsupported AI target configured.");
  }

  if (openMode === "new-window") {
    await chrome.windows.create({
      url: aiTarget.url,
      focused: true,
      type: "popup",
      width: 1200,
      height: 900
    });
    return;
  }

  await chrome.tabs.create({
    url: aiTarget.url,
    active: true
  });
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function fetchTranscriptPayload(videoUrl, fallbackTitle) {
  const response = await fetch(videoUrl, {
    credentials: "omit",
    headers: BROWSER_HEADERS
  });

  if (!response.ok) {
    throw new Error(`The YouTube page could not be loaded (HTTP ${response.status}).`);
  }

  const html = await response.text();

  if (!html || html.length < 500) {
    throw new Error("YouTube returned an empty or blocked page. Try reloading the video tab.");
  }

  const playerResponse = extractInitialPlayerResponse(html);
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
    throw new Error("The transcript track is missing a usable URL.");
  }

  const transcript =
    (await fetchJson3Transcript(preferredTrack.baseUrl)) ||
    (await fetchXmlTranscript(preferredTrack.baseUrl));

  if (!transcript) {
    throw new Error("The transcript did not contain any text.");
  }

  return {
    title: playerResponse?.videoDetails?.title || fallbackTitle || "Untitled video",
    url: videoUrl,
    transcript
  };
}

async function fetchJson3Transcript(baseUrl) {
  try {
    const response = await fetch(asJson3Url(baseUrl), {
      credentials: "omit",
      headers: { ...BROWSER_HEADERS, Accept: "application/json, */*" }
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();

    if (!text || text.trim() === "") {
      return null;
    }

    const json = JSON.parse(text);
    return parseJson3Transcript(json) || null;
  } catch {
    return null;
  }
}

async function fetchXmlTranscript(baseUrl) {
  try {
    const response = await fetch(baseUrl, {
      credentials: "omit",
      headers: { ...BROWSER_HEADERS, Accept: "text/xml, */*" }
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();

    if (!text || text.trim() === "") {
      return null;
    }

    return parseXmlTranscript(text) || null;
  } catch {
    return null;
  }
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

function buildPrompt(template, payload) {
  return template
    .replaceAll("{{title}}", payload.title)
    .replaceAll("{{url}}", payload.url)
    .replaceAll("{{transcript}}", payload.transcript);
}
