const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJson3Cues, cuesToText, formatTime } = require("../scripts/transcript-utils.js");

test("caption parsing preserves timestamps, joins word segments and skips metadata", () => {
  const cues = parseJson3Cues(JSON.stringify({ events: [
    { tStartMs: 12340, dDurationMs: 2500, segs: [{ utf8: "Hello " }, { utf8: "world\n" }] },
    { tStartMs: 0 }, { tStartMs: -1, segs: [{ utf8: "invalid" }] },
    { tStartMs: 3000, segs: [{ utf8: "  " }] }
  ] }));
  assert.deepEqual(cues, [{ start: 12.34, duration: 2.5, text: "Hello world" }]);
  assert.equal(cuesToText(cues, true), "[0:12] Hello world");
});
test("timestamp formatting supports long videos", () => {
  assert.equal(formatTime(3661.9), "1:01:01");
  assert.equal(formatTime(-10), "0:00");
});
test("invalid JSON is rejected rather than displayed as captions", () => {
  assert.throws(() => parseJson3Cues("not json"));
});
