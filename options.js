const { DEFAULT_SETTINGS, getPromptPresetDefinitions, normalizeSettings } = globalThis.YTTA_PROMPTS;

const form = document.getElementById("settingsForm");
const target = document.getElementById("target");
const openMode = document.getElementById("openMode");
const defaultPreset = document.getElementById("defaultPreset");
const reuseExistingChat = document.getElementById("reuseExistingChat");
const autoSubmit = document.getElementById("autoSubmit");
const promptTemplate = document.getElementById("promptTemplate");
const resetButton = document.getElementById("resetButton");
const statusMessage = document.getElementById("statusMessage");

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#fca5a5" : "#93c5fd";
}

function populatePresetOptions(selectedPreset) {
  defaultPreset.innerHTML = "";

  for (const preset of getPromptPresetDefinitions()) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    option.selected = preset.id === selectedPreset;
    defaultPreset.appendChild(option);
  }
}

async function populateForm() {
  const settings = normalizeSettings(await chrome.storage.sync.get(null));
  target.value = settings.target;
  openMode.value = settings.openMode;
  populatePresetOptions(settings.defaultPreset);
  reuseExistingChat.checked = Boolean(settings.reuseExistingChat);
  autoSubmit.checked = Boolean(settings.autoSubmit);
  promptTemplate.value = settings.promptTemplate;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    target: target.value,
    openMode: openMode.value,
    defaultPreset: defaultPreset.value,
    reuseExistingChat: reuseExistingChat.checked,
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
