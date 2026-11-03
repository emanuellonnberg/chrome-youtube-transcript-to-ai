const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSegments, findSkip } = require("../scripts/playback-utils.js");
const segment = (id, start, end, extra = {}) => ({ UUID: id, segment: [start, end], category: "sponsor", actionType: "skip", videoDuration: 100, ...extra });
test("SponsorBlock input accepts only selected categories and valid skip ranges", () => {
  const segments = normalizeSegments([
    segment("valid", 10, 20), segment("intro", 0, 5, { category: "intro" }),
    segment("mute", 5, 6, { actionType: "mute" }), segment("backwards", 20, 10),
    segment("negative", -10, 5), segment("bad", 1, Infinity)
  ], ["sponsor"]);
  assert.deepEqual(segments.map((item) => item.id), ["valid"]);
});
test("overlapping sponsor ranges are skipped together and can be excluded for Undo", () => {
  const segments = normalizeSegments([segment("a", 10, 20), segment("b", 18, 30), segment("c", 29, 35)]);
  const skip = findSkip(segments, 12, 100);
  assert.equal(skip.end, 35);
  assert.deepEqual(skip.ids, ["a", "b", "c"]);
  assert.equal(findSkip(segments, 12, 100, new Set(skip.ids)), null);
  assert.equal(findSkip(segments, 35, 100), null);
});
test("stale or out-of-bounds sponsor ranges cannot seek past the video", () => {
  const segments = normalizeSegments([segment("stale", 10, 20), segment("outside", 90, 110)]);
  assert.equal(findSkip(segments, 12, 120), null);
  assert.equal(findSkip(segments, 95, 100), null);
  assert.equal(findSkip(segments, 12, Infinity), null);
});
