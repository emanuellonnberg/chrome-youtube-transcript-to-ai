const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const playback = require("../scripts/playback-utils.js");

function service({ enabled = false, permission = true, status = 200 } = {}) {
  const requests = [];
  const settings = { sponsorBlockEnabled: enabled, sponsorCategories: ["sponsor"] };
  const context = vm.createContext({
    YTTA_PROMPTS: { normalizeSettings: (value) => value }, YTTA_PLAYBACK: playback,
    crypto: webcrypto, TextEncoder, URL, AbortSignal,
    chrome: { storage: { sync: { get: async () => settings } }, permissions: { contains: async () => permission } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { status, ok: status === 200, json: async () => [
        { videoID: "abcdefghijk", segments: [{ UUID: "a", category: "sponsor", actionType: "skip", segment: [10, 20] }] },
        { videoID: "other_video", segments: [{ UUID: "other", category: "sponsor", actionType: "skip", segment: [50, 60] }] }
      ] };
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../scripts/sponsor-service.js"), "utf8"), context);
  return { api: context.YTTA_SPONSORS, requests, settings };
}
test("SponsorBlock makes no request when disabled or without optional permission", async () => {
  const disabled = service();
  assert.equal((await disabled.api.getSegments("abcdefghijk")).length, 0);
  assert.equal(disabled.requests.length, 0);
  const denied = service({ enabled: true, permission: false });
  await assert.rejects(denied.api.getSegments("abcdefghijk"), /Allow SponsorBlock access/);
  assert.equal(denied.requests.length, 0);
});
test("SponsorBlock sends a hash prefix, filters other videos and caches simultaneous lookups", async () => {
  const { api, requests, settings } = service({ enabled: true });
  const [first, second] = await Promise.all([api.getSegments("abcdefghijk"), api.getSegments("abcdefghijk")]);
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.match(url.pathname, /^\/api\/skipSegments\/[0-9a-f]{4}$/);
  assert.ok(!requests[0].url.includes("abcdefghijk"));
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(first.map((item) => item.id), ["a"]);
  assert.deepEqual(second, first);
  settings.sponsorBlockEnabled = false;
  assert.equal((await api.getSegments("abcdefghijk")).length, 0, "Disabled setting must bypass even cached results");
});
test("SponsorBlock no-data responses and server failures are handled separately", async () => {
  const missing = service({ enabled: true, status: 404 });
  assert.equal((await missing.api.getSegments("abcdefghijk")).length, 0);
  const failed = service({ enabled: true, status: 503 });
  await assert.rejects(failed.api.getSegments("abcdefghijk"), /HTTP 503/);
  await assert.rejects(failed.api.getSegments("abcdefghijk"), /HTTP 503/);
  assert.equal(failed.requests.length, 2, "Failed responses are not retained in the cache");
});
