const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const delivery = require("../scripts/prompt-delivery.js");

function background({ hasDraft = false, acknowledge = true } = {}) {
  const stored = { transcriptHistory: [{ id: "keep" }] };
  const listeners = new Set();
  const destinations = [];
  let nextTab = 6;
  const tabs = [{ id: 5, active: true }];
  const local = {
    async get(key) { return structuredClone(key ? { [key]: stored[key] } : stored); },
    async set(value) {
      Object.assign(stored, value);
      const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }]));
      for (const listener of listeners) listener(changes, "local");
      for (const [key, prompt] of Object.entries(value)) {
        if (key.startsWith(delivery.PREFIX)) {
          destinations.push({ text: prompt.prompt, tab: prompt.targetTabId });
          if (acknowledge) setTimeout(() => { void local.set({ [`${delivery.RESULT_PREFIX}${prompt.id}`]: { ok: true, inserted: true, expiresAt: prompt.expiresAt } }); }, 20);
        }
      }
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
  };
  const context = vm.createContext({
    importScripts() {}, YTTA_PROMPTS: {}, YTTA_HISTORY: {}, YTTA_DELIVERY: delivery,
    console: { log() {} }, setTimeout, clearTimeout,
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
      storage: { local, onChanged: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) } },
      tabs: { query: async () => tabs, sendMessage: async () => ({ ready: true, hasDraft, busy: false }),
        update: async () => {}, create: async () => { const tab = { id: nextTab++ }; tabs.push(tab); return tab; } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../scripts/background.js"), "utf8"), context);
  return { context, stored, destinations, listeners };
}
test("two quick sends reserve separate tabs and both receive acknowledgments", async () => {
  const { context, stored, destinations, listeners } = background();
  const result = await vm.runInContext('Promise.all([dispatchPrompt("First", { target: "chatgpt", reuseExistingChat: true }, "one"), dispatchPrompt("Second", { target: "chatgpt", reuseExistingChat: true }, "two")])', context);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.inserted));
  assert.deepEqual(destinations, [{ text: "First", tab: 5 }, { text: "Second", tab: 6 }]);
  assert.deepEqual(Object.keys(stored), ["transcriptHistory"]);
  assert.equal(listeners.size, 0);
});
test("an existing draft causes a new tab to be opened", async () => {
  const { context, destinations } = background({ hasDraft: true });
  await vm.runInContext('dispatchPrompt("Transcript", { target: "chatgpt", reuseExistingChat: true }, "one")', context);
  assert.equal(destinations[0].tab, 6);
});
test("a delivery timeout reports failure and removes the stale prompt", async () => {
  const { context, stored, listeners } = background({ acknowledge: false });
  stored["pendingPrompt:old"] = { id: "old", expiresAt: 1 };
  await assert.rejects(vm.runInContext('waitForDelivery("old", Date.now() - 1)', context), /not ready in time/);
  assert.equal(stored["pendingPrompt:old"], undefined);
  assert.equal(listeners.size, 0);
});
