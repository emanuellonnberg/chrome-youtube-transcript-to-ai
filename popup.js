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

const targetLabel = document.getElementById("targetLabel");
const openModeLabel = document.getElementById("openModeLabel");
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

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  targetLabel.textContent = prettifyTarget(settings.target);
  openModeLabel.textContent = prettifyOpenMode(settings.openMode);
  return settings;
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
}

async function handleSendClick() {
  sendButton.disabled = true;
  setStatus("Collecting transcript...");

  try {
    const activeTab = await getActiveTab();

    if (!activeTab?.url || !activeTab.url.startsWith("https://www.youtube.com/watch")) {
      throw new Error("Open a YouTube watch page before sending the transcript.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "sendTranscriptToAi",
      tab: {
        id: activeTab.id,
        title: activeTab.title || "",
        url: activeTab.url
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The transcript could not be sent.");
    }

    setStatus(`Transcript opened in ${prettifyTarget(response.target)}.`);
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
});
