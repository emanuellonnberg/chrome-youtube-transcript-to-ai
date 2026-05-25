const PENDING_PROMPT_KEY = "pendingPrompt";
const POLL_INTERVAL_MS = 1500;
const EXPIRY_MS = 45000;
let lastHandledPromptId = null;

const TARGET_BY_HOST = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude"
};

const INPUT_SELECTORS = {
  chatgpt: [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "div[contenteditable='true'][data-testid*='composer']",
    "div[contenteditable='true'][aria-label*='Message']"
  ],
  claude: [
    "div[contenteditable='true'][data-testid='chat-input']",
    "div[contenteditable='true'].ProseMirror",
    "div[contenteditable='true'][aria-label*='Talk to Claude']"
  ]
};

const SUBMIT_SELECTORS = {
  chatgpt: [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[type='submit']"
  ],
  claude: [
    "button[aria-label*='Send Message']",
    "button[aria-label*='Send message']",
    "button[data-testid='send-button']",
    "button[type='submit']"
  ]
};

function getCurrentTarget() {
  return TARGET_BY_HOST[window.location.hostname] || null;
}

function dispatchInputEvent(element) {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertIntoInput(element, text) {
  element.focus();

  if (element instanceof HTMLTextAreaElement) {
    element.value = text;
    dispatchInputEvent(element);
    return true;
  }

  if (element.isContentEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.deleteContents();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, text);

    if (element.textContent?.trim() !== text.trim()) {
      element.textContent = text;
    }

    dispatchInputEvent(element);
    return true;
  }

  return false;
}

function clickSubmit(target) {
  for (const selector of SUBMIT_SELECTORS[target] || []) {
    const button = document.querySelector(selector);

    if (button && !button.disabled) {
      button.click();
      return true;
    }
  }

  const input = findInput(target);

  if (!input) {
    return false;
  }

  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
  return true;
}

function findInput(target) {
  for (const selector of INPUT_SELECTORS[target] || []) {
    const element = document.querySelector(selector);

    if (element) {
      return element;
    }
  }

  return null;
}

async function clearPromptIfCurrent(promptId) {
  const stored = await chrome.storage.local.get(PENDING_PROMPT_KEY);
  const pendingPrompt = stored[PENDING_PROMPT_KEY];

  if (pendingPrompt?.id === promptId) {
    await chrome.storage.local.remove(PENDING_PROMPT_KEY);
  }
}

async function tryHandlePrompt(pendingPrompt) {
  const currentTarget = getCurrentTarget();

  if (!currentTarget || !pendingPrompt || pendingPrompt.target !== currentTarget) {
    return false;
  }

  if (lastHandledPromptId === pendingPrompt.id) {
    return true;
  }

  const input = findInput(currentTarget);

  if (!input) {
    return false;
  }

  if (!insertIntoInput(input, pendingPrompt.prompt)) {
    return false;
  }

  lastHandledPromptId = pendingPrompt.id;

  if (pendingPrompt.autoSubmit) {
    window.setTimeout(() => clickSubmit(currentTarget), 300);
  }

  await clearPromptIfCurrent(pendingPrompt.id);
  return true;
}

async function pollForPrompt(deadline) {
  if (Date.now() > deadline) {
    return;
  }

  const stored = await chrome.storage.local.get(PENDING_PROMPT_KEY);
  const pendingPrompt = stored[PENDING_PROMPT_KEY];

  if (await tryHandlePrompt(pendingPrompt)) {
    return;
  }

  window.setTimeout(() => pollForPrompt(deadline), POLL_INTERVAL_MS);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[PENDING_PROMPT_KEY]?.newValue) {
    return;
  }

  void tryHandlePrompt(changes[PENDING_PROMPT_KEY].newValue);
});

void pollForPrompt(Date.now() + EXPIRY_MS);
