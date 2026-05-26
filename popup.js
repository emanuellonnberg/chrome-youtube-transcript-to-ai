const { getPromptPresetDefinitions, getPromptPresetLabel, normalizeSettings } = globalThis.YTTA_PROMPTS;

const targetLabel = document.getElementById("targetLabel");
const openModeLabel = document.getElementById("openModeLabel");
const presetSelect = document.getElementById("presetSelect");
const sendButton = document.getElementById("sendButton");
const optionsButton = document.getElementById("optionsButton");
const statusMessage = document.getElementById("statusMessage");

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

sendButton.addEventListener("click", handleSendClick);
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

loadSettings().catch(() => {
  targetLabel.textContent = "ChatGPT";
  openModeLabel.textContent = "New tab";
  populatePresetOptions("short-summary");
});
