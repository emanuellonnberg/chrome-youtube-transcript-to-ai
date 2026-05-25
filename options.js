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

const form = document.getElementById("settingsForm");
const target = document.getElementById("target");
const openMode = document.getElementById("openMode");
const autoSubmit = document.getElementById("autoSubmit");
const promptTemplate = document.getElementById("promptTemplate");
const resetButton = document.getElementById("resetButton");
const statusMessage = document.getElementById("statusMessage");

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#fca5a5" : "#93c5fd";
}

async function populateForm() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  target.value = settings.target;
  openMode.value = settings.openMode;
  autoSubmit.checked = Boolean(settings.autoSubmit);
  promptTemplate.value = settings.promptTemplate;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    target: target.value,
    openMode: openMode.value,
    autoSubmit: autoSubmit.checked,
    promptTemplate: promptTemplate.value.trim() || DEFAULT_SETTINGS.promptTemplate
  });

  setStatus("Settings saved.");
});

resetButton.addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await populateForm();
  setStatus("Defaults restored.");
});

populateForm().catch(() => setStatus("Settings could not be loaded.", true));
