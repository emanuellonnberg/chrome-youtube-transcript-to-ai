// Content script running inside the YouTube watch tab.
// The background worker sends a "getTranscript" message here because:
//   1. We can read ytInitialPlayerResponse directly from the DOM.
//   2. fetch() here carries the user's cookies, satisfying YouTube's auth.
//   3. We can extract the proof-of-origin token (pot) via performance timing.

const POT_POLL_INTERVAL_MS = 50;
const POT_POLL_ATTEMPTS = 20; // ~1 second total

// ----- Entry point -----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "getTranscript") {
    return false;
  }

  extractTranscriptPayload()
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true; // keep the message channel open for async response
});

// ----- Transcript extraction -----

async function extractTranscriptPayload() {
  const playerResponse = readPlayerResponseFromDom();
  const captionTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (!captionTracks.length) {
    throw new Error("No transcript is available for this video.");
  }

  const preferredTrack =
    captionTracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ||
    captionTracks.find((t) => t.kind !== "asr") ||
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

// ----- Read ytInitialPlayerResponse from the page DOM -----

function readPlayerResponseFromDom() {
  // Fastest path: the variable is on window (injected by YouTube)
  if (window.ytInitialPlayerResponse) {
    return window.ytInitialPlayerResponse;
  }

  // Fallback: scrape it from the raw page HTML embedded in a script tag
  const scripts = document.querySelectorAll("script");

  for (const script of scripts) {
    const text = script.textContent || "";

    if (!text.includes("ytInitialPlayerResponse")) {
      continue;
    }

    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:\s*var\s|\s*window\.|$)/s);

    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // try next script tag
      }
    }
  }

  throw new Error("Could not read the YouTube player data from the page.");
}

// ----- Proof-of-origin token (pot) -----
// YouTube requires &pot=<token> on the timedtext URL.
// We get it by briefly toggling the CC button and watching the outgoing
// /api/timedtext network request that the player fires.

const CC_BUTTON_SELECTORS = [
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > div.ytp-right-controls > button.ytp-subtitles-button",
  ".ytp-subtitles-button"
];

function findCcButton() {
  for (const sel of CC_BUTTON_SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn) return btn;
  }
  return null;
}

async function getPot() {
  // Try reading a cached pot first (populated from a previous click)
  const cached = readPotFromPerformance();
  if (cached) return cached;

  const btn = findCcButton();
  if (!btn) return "";

  // Double-click trick: first click triggers the player to fetch the track,
  // second click restores the original CC state.
  try {
    performance.clearResourceTimings();
    btn.click();
    btn.click();
  } catch {
    return "";
  }

  // Poll for the timedtext request to appear in performance entries
  for (let i = 0; i < POT_POLL_ATTEMPTS; i++) {
    await sleep(POT_POLL_INTERVAL_MS);
    const pot = readPotFromPerformance();
    if (pot) return pot;
  }

  return "";
}

function readPotFromPerformance() {
  const entries = performance.getEntriesByType("resource");

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    if (!entry.name.includes("/api/timedtext")) continue;

    try {
      const pot = new URL(entry.name).searchParams.get("pot");
      if (pot) return pot;
    } catch {
      // malformed URL, skip
    }
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----- Build the final timedtext URL -----
// IMPORTANT: the baseUrl is a signed URL. Never rewrite it with `new URL()` +
// searchParams — that reorders the query string and breaks the signature (404).
// Instead, just append extra params as a plain string.

function buildTranscriptUrl(baseUrl, pot) {
  if (pot) {
    return `${baseUrl}&pot=${encodeURIComponent(pot)}&c=WEB`;
  }

  return baseUrl;
}

// ----- Fetch and parse the transcript XML -----

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
