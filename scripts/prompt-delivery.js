(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTTA_DELIVERY = api;
})(globalThis, () => {
  const PREFIX = "pendingPrompt:";
  const RESULT_PREFIX = "promptResult:";
  const TTL_MS = 45000;
  function isPendingKey(key) { return key.startsWith(PREFIX); }
  function isExpired(prompt, now = Date.now()) {
    return !Number.isFinite(prompt?.expiresAt) || prompt.expiresAt <= now;
  }
  function belongsTo(prompt, target, tabId) {
    return typeof prompt?.id === "string" && typeof prompt.prompt === "string" &&
      Number.isInteger(tabId) && prompt.targetTabId === tabId && prompt.target === target;
  }
  return { PREFIX, RESULT_PREFIX, TTL_MS, isPendingKey, isExpired, belongsTo };
});
