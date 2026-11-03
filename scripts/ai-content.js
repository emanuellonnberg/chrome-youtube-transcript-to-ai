const POLL_INTERVAL_MS = 300;
const { PREFIX, RESULT_PREFIX, isPendingKey, isExpired, belongsTo } = YTTA_DELIVERY;
const DEBUG_PREFIX = "[YTTA][AI]";
let currentTabIdPromise = null;
let handling = false;
let handleAgain = false;
let pollTimer = null;
const handledIds = new Set();

function debugLog(step, details = null) {
  console.log(DEBUG_PREFIX, step, details || "");
}

const TARGET_BY_HOST = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini"
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
  ],
  gemini: [
    "div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "div[contenteditable='true'][aria-label*='Enter a prompt']",
    "div[contenteditable='true'][aria-label*='Type something']"
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
  ],
  gemini: [
    "button[aria-label*='Send message']",
    "button[data-test-id='send-button']",
    "button.send-button",
    "button[jsname='Qx7uuf']"
  ]
};

function getCurrentTarget() {
  return TARGET_BY_HOST[window.location.hostname] || null;
}

async function getCurrentTabId() {
  if (!currentTabIdPromise) {
    debugLog("request current tab id");
    currentTabIdPromise = chrome.runtime
      .sendMessage({ type: "getCurrentTabId" })
      .then((response) => {
        debugLog("current tab id response", response);
        return response?.tabId || null;
      })
      .catch((error) => {
        currentTabIdPromise = null;
        debugLog("current tab id failed", { message: error?.message || String(error) });
        return null;
      });
  }

  return currentTabIdPromise;
}

function dispatchInputEvent(element) {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertIntoInput(element, text) {
  debugLog("insertIntoInput", {
    tagName: element.tagName,
    isTextArea: element instanceof HTMLTextAreaElement,
    isContentEditable: element.isContentEditable,
    textLength: text.length
  });
  element.focus();

  if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(element, text); else element.value = text;
    dispatchInputEvent(element);
    return element.value === text;
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
    return element.textContent?.trim() === text.trim();
  }

  return false;
}

function clickSubmit(target) {
  for (const selector of SUBMIT_SELECTORS[target] || []) {
    const button = document.querySelector(selector);

    if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length) {
      debugLog("clickSubmit matched button", { target, selector });
      button.click();
      return true;
    }
  }

  return false;
}

function findInput(target) {
  for (const selector of INPUT_SELECTORS[target] || []) {
    const element = document.querySelector(selector);

    if (element && !element.disabled && !element.readOnly && element.getClientRects().length) {
      debugLog("findInput matched", { target, selector });
      return element;
    }
  }

  debugLog("findInput no match", { target, selectorCount: INPUT_SELECTORS[target]?.length || 0 });
  return null;
}

function inputText(input) { return input instanceof HTMLTextAreaElement ? input.value : input?.textContent || ""; }
function isGenerating() {
  return [...document.querySelectorAll("button[data-testid='stop-button'], button[aria-label='Stop generating'], button[aria-label='Stop response'], button[aria-label='Stop streaming']")]
    .some((button) => button.getClientRects().length);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "getComposerState") return false;
  const input = findInput(getCurrentTarget());
  sendResponse({ ready: Boolean(input), hasDraft: Boolean(inputText(input).trim()), busy: handling || isGenerating() });
  return false;
});

async function finishPrompt(prompt, result) {
  await chrome.storage.local.set({ [`${RESULT_PREFIX}${prompt.id}`]: { ...result, expiresAt: prompt.expiresAt } });
  await chrome.storage.local.remove(`${PREFIX}${prompt.id}`);
}

async function tryHandlePrompt(prompt) {
  if (!belongsTo(prompt, getCurrentTarget(), await getCurrentTabId())) return true;
  if (isExpired(prompt)) {
    await chrome.storage.local.remove(`${PREFIX}${prompt.id}`);
    return true;
  }
  if (handledIds.has(prompt.id)) return true;
  const input = findInput(getCurrentTarget());
  if (!input || isGenerating()) return false;
  if (inputText(input).trim()) {
    await finishPrompt(prompt, { ok: false, error: "An existing AI draft was preserved. Send again to open another chat." });
    return true;
  }
  if (!insertIntoInput(input, prompt.prompt)) {
    await finishPrompt(prompt, { ok: false, error: "The AI composer did not accept the transcript. Resend the saved transcript." });
    return true;
  }
  handledIds.add(prompt.id);
  while (handledIds.size > 100) handledIds.delete(handledIds.values().next().value);
  debugLog("prompt inserted", { promptId: prompt.id, promptLength: prompt.prompt.length });
  let autoSubmitted = false;
  if (prompt.autoSubmit) {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      // A user edit or navigation cancels automatic submission.
      if (isExpired(prompt) || !input.isConnected || inputText(input).trim() !== prompt.prompt.trim()) break;
      if (clickSubmit(getCurrentTarget())) { autoSubmitted = true; break; }
    }
  }
  await finishPrompt(prompt, { ok: true, inserted: true, autoSubmitted, manualSubmitRequired: Boolean(prompt.autoSubmit && !autoSubmitted) });
  return true;
}

async function processPrompts() {
  if (handling) { handleAgain = true; return; }
  handling = true;
  clearTimeout(pollTimer);
  pollTimer = null;
  let retry = false;
  try {
    const stored = await chrome.storage.local.get(null);
    const tabId = await getCurrentTabId();
    for (const [key, prompt] of Object.entries(stored)) {
      if (!isPendingKey(key) || !belongsTo(prompt, getCurrentTarget(), tabId)) continue;
      if (!await tryHandlePrompt(prompt)) retry = true;
    }
  } catch (error) { debugLog("prompt delivery failed", { message: error.message }); }
  finally {
    handling = false;
    if (retry || handleAgain) {
      handleAgain = false;
      pollTimer = setTimeout(() => { void processPrompts(); }, POLL_INTERVAL_MS);
    }
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.entries(changes).some(([key, change]) => isPendingKey(key) && change.newValue)) void processPrompts();
});
void processPrompts();
