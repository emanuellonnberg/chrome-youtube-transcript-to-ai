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
const autoSkipAds = document.getElementById("autoSkipAds");
const sponsorBlockEnabled = document.getElementById("sponsorBlockEnabled");
const sponsorCategoryInputs = [...document.querySelectorAll("#sponsorCategories input")];
const sponsorOrigin = { origins: ["https://sponsor.ajay.app/*"] };

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
  autoSkipAds.checked = settings.autoSkipAds;
  sponsorBlockEnabled.checked = settings.sponsorBlockEnabled;
  sponsorCategoryInputs.forEach((input) => { input.checked = settings.sponsorCategories.includes(input.value); });
  promptTemplate.value = settings.promptTemplate;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
  // Request optional access directly from the Save gesture, before other awaits.
  if (sponsorBlockEnabled.checked && !await chrome.permissions.request(sponsorOrigin)) {
    setStatus("SponsorBlock access was not granted. Disable that option or allow access, then save again.", true);
    return;
  }
  await chrome.storage.sync.set({
    target: target.value,
    openMode: openMode.value,
    defaultPreset: defaultPreset.value,
    reuseExistingChat: reuseExistingChat.checked,
    autoSubmit: autoSubmit.checked,
    autoSkipAds: autoSkipAds.checked,
    sponsorBlockEnabled: sponsorBlockEnabled.checked,
    sponsorCategories: sponsorCategoryInputs.filter((input) => input.checked).map((input) => input.value),
    promptTemplate: promptTemplate.value.trim() || DEFAULT_SETTINGS.promptTemplate
  });

  setStatus("Settings saved.");
  } catch (error) { setStatus(error.message || "Settings could not be saved.", true); }
});

resetButton.addEventListener("click", async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await populateForm();
  setStatus("Defaults restored.");
});

populateForm().catch(() => setStatus("Settings could not be loaded.", true));
