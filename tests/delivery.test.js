const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const delivery = require("../scripts/prompt-delivery.js");

test("pending prompts require an exact target tab and have a persisted expiry", () => {
  const prompt = { id: "a", prompt: "text", target: "claude", targetTabId: 4, expiresAt: 500 };
  assert.equal(delivery.belongsTo(prompt, "claude", 4), true);
  assert.equal(delivery.belongsTo(prompt, "claude", 5), false);
  assert.equal(delivery.belongsTo({ ...prompt, targetTabId: null }, "claude", 4), false);
  assert.equal(delivery.isExpired(prompt, 499), false);
  assert.equal(delivery.isExpired(prompt, 500), true);
  assert.equal(delivery.isExpired({}), true);
});

function aiContext(entries, draft = "") {
  const stored = structuredClone(entries);
  const writes = [];
  class TextArea {
    constructor() { this.value = draft; this.isConnected = true; }
    getClientRects() { return [1]; }
    focus() {}
    dispatchEvent() {}
  }
  const input = new TextArea();
  const context = vm.createContext({
    YTTA_DELIVERY: delivery, HTMLTextAreaElement: TextArea,
    InputEvent: class {}, Event: class {}, console: { log() {} },
    window: { location: { hostname: "chatgpt.com" } },
    document: { querySelector: (selector) => selector === "#prompt-textarea" ? input : null, querySelectorAll: () => [] },
    chrome: {
      runtime: { sendMessage: async () => ({ tabId: 7 }), onMessage: { addListener() {} } },
      storage: {
        local: {
          get: async () => structuredClone(stored),
          set: async (value) => { Object.assign(stored, value); writes.push(value); },
          remove: async (key) => { delete stored[key]; }
        }, onChanged: { addListener() {} }
      }
    }, setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(require.resolve("../scripts/ai-content.js"), "utf8"), context);
  return { context, stored, writes, input };
}
const prompt = (id, extra = {}) => ({ id, prompt: `Transcript ${id}`, target: "chatgpt", targetTabId: 7, expiresAt: Date.now() + 45000, ...extra });
async function settle(context) {
  await new Promise((resolve) => setImmediate(resolve));
  await vm.runInContext("processPrompts()", context);
}
test("AI delivery preserves a draft and reports the reason", async () => {
  const { context, input, stored } = aiContext({ "pendingPrompt:a": prompt("a") }, "My unfinished thought");
  await settle(context);
  assert.equal(input.value, "My unfinished thought");
  assert.equal(stored["promptResult:a"].ok, false);
  assert.match(stored["promptResult:a"].error, /draft was preserved/);
});
test("expired prompts and prompts for another tab never reach the composer", async () => {
  const { context, input, stored } = aiContext({
    "pendingPrompt:old": prompt("old", { expiresAt: 1 }),
    "pendingPrompt:other": prompt("other", { targetTabId: 8 })
  });
  await settle(context);
  assert.equal(input.value, "");
  assert.equal(stored["pendingPrompt:old"], undefined);
  assert.ok(stored["pendingPrompt:other"]);
});
test("concurrent delivery callbacks insert a request once and acknowledge insertion", async () => {
  const { context, input, stored, writes } = aiContext({ "pendingPrompt:a": prompt("a") });
  await Promise.all([vm.runInContext("processPrompts()", context), settle(context)]);
  assert.equal(input.value, "Transcript a");
  assert.equal(stored["promptResult:a"].inserted, true);
  assert.equal(writes.length, 1);
  assert.equal(stored["pendingPrompt:a"], undefined);
});

function backgroundContext() {
  const stored = {};
  const context = vm.createContext({
    console: { log() {} }, setTimeout, clearTimeout,
    importScripts() {}, YTTA_PROMPTS: {}, YTTA_HISTORY: {}, YTTA_DELIVERY: delivery,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
      storage: { local: { get: async () => structuredClone(stored), remove: async (keys) => { for (const key of keys) delete stored[key]; } }, onChanged: { addListener() {}, removeListener() {} } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../scripts/background.js"), "utf8"), context);
  return { context, stored };
}
test("prompt placeholders treat source text literally without expanding replacement tokens", () => {
  const { context } = backgroundContext();
  context.payload = { title: "Example $& {{transcript}}", transcript: "$& content", url: "url" };
  context.template = "{{title}}\n{{transcript}}";
  assert.equal(vm.runInContext("buildPrompt(template, payload)", context), "Example $& {{transcript}}\n$& content");
});
