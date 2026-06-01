const { getPromptPresetDefinitions, getPromptPresetLabel, normalizeSettings } = globalThis.YTTA_PROMPTS;
const {
  sanitizeHistory,
  sortHistoryForDisplay,
  toggleHistoryPinned,
  deleteHistoryEntry,
  clearUnpinnedHistory
} = globalThis.YTTA_HISTORY;
const { buildTranscriptExport } = globalThis.YTTA_EXPORTS;

const HISTORY_KEY = "transcriptHistory";
const MAX_COMPARE = 2;

const targetLabel = document.getElementById("targetLabel");
const openModeLabel = document.getElementById("openModeLabel");
const presetSelect = document.getElementById("presetSelect");
const sendButton = document.getElementById("sendButton");
const optionsButton = document.getElementById("optionsButton");
const statusMessage = document.getElementById("statusMessage");
const compareButton = document.getElementById("compareButton");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const historyEmptyState = document.getElementById("historyEmptyState");
const historyList = document.getElementById("historyList");

let currentHistory = [];
const selectedIds = new Set();

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#fca5a5" : "#bfdbfe";
}

function prettifyTarget(target) {
  if (target === "claude") return "Claude";
  if (target === "gemini") return "Gemini";
  return "ChatGPT";
}

function prettifyOpenMode(openMode) {
  return openMode === "new-window" ? "New window" : "New tab";
}

function populatePresetOptions(selectedPreset) {
  presetSelect.innerHTML = "";

  for (const preset of getPromptPresetDefinitions()) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    option.selected = preset.id === selectedPreset;
    presetSelect.appendChild(option);
  }
}

async function loadSettings() {
  const settings = normalizeSettings(await chrome.storage.sync.get(null));
  targetLabel.textContent = prettifyTarget(settings.target);
  openModeLabel.textContent = prettifyOpenMode(settings.openMode);
  populatePresetOptions(settings.defaultPreset);
  return settings;
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
}

async function handleSendClick() {
  const presetId = presetSelect.value;

  sendButton.disabled = true;
  setStatus(`Collecting transcript for ${getPromptPresetLabel(presetId)}...`);

  try {
    const activeTab = await getActiveTab();

    if (!activeTab?.url || !activeTab.url.startsWith("https://www.youtube.com/watch")) {
      throw new Error("Open a YouTube watch page before sending the transcript.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "sendTranscriptToAi",
      presetId,
      tab: {
        id: activeTab.id,
        title: activeTab.title || "",
        url: activeTab.url
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The transcript could not be sent.");
    }

    setStatus(
      `${getPromptPresetLabel(response.presetId || presetId)} opened in ${prettifyTarget(response.target)}.`
    );
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  } finally {
    sendButton.disabled = false;
  }
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  currentHistory = sanitizeHistory(stored[HISTORY_KEY]);
  pruneSelection();
  renderHistory();
}

async function persistHistory(nextHistory) {
  currentHistory = sanitizeHistory(nextHistory);
  await chrome.storage.local.set({ [HISTORY_KEY]: currentHistory });
  pruneSelection();
  renderHistory();
}

function pruneSelection() {
  const knownIds = new Set(currentHistory.map((entry) => entry.id));
  for (const id of [...selectedIds]) {
    if (!knownIds.has(id)) {
      selectedIds.delete(id);
    }
  }
}

function formatSavedAt(savedAt) {
  const parsed = Date.parse(savedAt || "");
  if (!parsed) {
    return "";
  }
  return new Date(parsed).toLocaleString();
}

function buildExcerpt(transcript) {
  const collapsed = (transcript || "").replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}…` : collapsed;
}

function findEntry(historyId) {
  return currentHistory.find((entry) => entry.id === historyId) || null;
}

function updateToolbar() {
  compareButton.disabled = selectedIds.size !== MAX_COMPARE;
  clearHistoryButton.disabled = !currentHistory.some((entry) => !entry.pinned);
}

function renderHistory() {
  historyList.innerHTML = "";
  const sorted = sortHistoryForDisplay(currentHistory);
  historyEmptyState.style.display = sorted.length ? "none" : "block";

  for (const entry of sorted) {
    historyList.appendChild(buildHistoryItem(entry));
  }

  updateToolbar();
}

function buildHistoryItem(entry) {
  const item = document.createElement("div");
  item.className = "historyItem";

  const header = document.createElement("div");
  header.className = "historyItemHeader";

  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "historyCheckbox";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedIds.has(entry.id);
  checkbox.disabled = !checkbox.checked && selectedIds.size >= MAX_COMPARE;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedIds.add(entry.id);
    } else {
      selectedIds.delete(entry.id);
    }
    renderHistory();
  });
  checkboxLabel.appendChild(checkbox);
  checkboxLabel.appendChild(document.createTextNode("Compare"));
  header.appendChild(checkboxLabel);

  if (entry.pinned) {
    const pinnedBadge = document.createElement("span");
    pinnedBadge.className = "historyPinned";
    pinnedBadge.textContent = "Pinned";
    header.appendChild(pinnedBadge);
  }

  item.appendChild(header);

  const title = document.createElement("p");
  title.className = "historyTitle";
  const titleLink = document.createElement("a");
  titleLink.href = entry.url;
  titleLink.target = "_blank";
  titleLink.rel = "noreferrer";
  titleLink.textContent = entry.title || "Untitled video";
  title.appendChild(titleLink);
  item.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "historyMeta";
  const savedAt = formatSavedAt(entry.savedAt);
  const presetLabel = entry.presetId ? getPromptPresetLabel(entry.presetId) : "";
  meta.textContent = [presetLabel, savedAt].filter(Boolean).join(" · ");
  item.appendChild(meta);

  const excerpt = document.createElement("p");
  excerpt.className = "historyExcerpt";
  excerpt.textContent = buildExcerpt(entry.transcript);
  item.appendChild(excerpt);

  const actions = document.createElement("div");
  actions.className = "historyActions";
  actions.appendChild(
    makeActionButton("Resend", () => resendEntry(entry))
  );
  actions.appendChild(
    makeActionButton(entry.pinned ? "Unpin" : "Pin", () =>
      persistHistory(toggleHistoryPinned(currentHistory, entry.id))
    )
  );
  actions.appendChild(
    makeActionButton("Export", () => exportEntry(entry))
  );
  actions.appendChild(
    makeActionButton("Delete", () =>
      persistHistory(deleteHistoryEntry(currentHistory, entry.id))
    )
  );
  item.appendChild(actions);

  return item;
}

function makeActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function resendEntry(entry) {
  setStatus(`Resending "${entry.title || "saved transcript"}"...`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "resendTranscript",
      entry,
      presetId: presetSelect.value
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The transcript could not be resent.");
    }

    setStatus(`Opened in ${prettifyTarget(response.target)}.`);
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  }
}

function exportEntry(entry) {
  try {
    const { fileName, mimeType, content } = buildTranscriptExport(entry);
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${fileName}.`);
  } catch (error) {
    setStatus(error.message || "Could not export this transcript.", true);
  }
}

async function handleCompareClick() {
  const entries = [...selectedIds].map(findEntry).filter(Boolean);

  if (entries.length !== MAX_COMPARE) {
    setStatus("Select exactly two saved transcripts to compare.", true);
    return;
  }

  compareButton.disabled = true;
  setStatus("Building comparison prompt...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "compareTranscripts",
      entries,
      presetId: presetSelect.value
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The comparison could not be sent.");
    }

    setStatus(`Comparison opened in ${prettifyTarget(response.target)}.`);
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  } finally {
    updateToolbar();
  }
}

function handleClearHistoryClick() {
  persistHistory(clearUnpinnedHistory(currentHistory)).catch((error) =>
    setStatus(error.message || "Could not clear history.", true)
  );
}

sendButton.addEventListener("click", handleSendClick);
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
compareButton.addEventListener("click", handleCompareClick);
clearHistoryButton.addEventListener("click", handleClearHistoryClick);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[HISTORY_KEY]) {
    currentHistory = sanitizeHistory(changes[HISTORY_KEY].newValue);
    pruneSelection();
    renderHistory();
  }
});

loadSettings().catch(() => {
  targetLabel.textContent = "ChatGPT";
  openModeLabel.textContent = "New tab";
  populatePresetOptions("short-summary");
});

loadHistory().catch(() => {
  currentHistory = [];
  renderHistory();
});
