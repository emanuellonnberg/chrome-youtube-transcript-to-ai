const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_HISTORY_ITEMS,
  clearUnpinnedHistory,
  sortHistoryForDisplay,
  toggleHistoryPinned,
  upsertHistoryEntry
} = require("../scripts/history-store.js");

function createEntry(index, overrides = {}) {
  return {
    id: overrides.id || `id-${index}`,
    title: overrides.title || `Video ${index}`,
    url: overrides.url || `https://youtube.com/watch?v=${index}`,
    transcript: overrides.transcript || `Transcript ${index}`,
    presetId: overrides.presetId || "short-summary",
    savedAt: overrides.savedAt || `2026-05-${String(index).padStart(2, "0")}T12:00:00.000Z`,
    pinned: Boolean(overrides.pinned)
  };
}

test("upsertHistoryEntry preserves pinned items while capping unpinned history", () => {
  const existingHistory = [
    createEntry(99, { id: "pinned", pinned: true, savedAt: "2026-05-01T00:00:00.000Z" }),
    ...Array.from({ length: MAX_HISTORY_ITEMS }, (_, index) => createEntry(index + 1))
  ];

  const nextHistory = upsertHistoryEntry(
    existingHistory,
    {
      title: "Newest Video",
      url: "https://youtube.com/watch?v=new",
      transcript: "Newest transcript"
    },
    "detailed-analysis",
    {
      createId: () => "new-id",
      savedAt: "2026-05-31T12:00:00.000Z"
    }
  );

  assert.equal(nextHistory.filter((entry) => !entry.pinned).length, MAX_HISTORY_ITEMS);
  assert.equal(nextHistory.some((entry) => entry.id === "pinned"), true);
  assert.equal(nextHistory.some((entry) => entry.url === "https://youtube.com/watch?v=8"), false);
  assert.equal(nextHistory[0].id, "new-id");
});

test("upsertHistoryEntry keeps the same id and pin state when re-saving a video", () => {
  const existingHistory = [
    createEntry(1, {
      id: "stable-id",
      url: "https://youtube.com/watch?v=same",
      transcript: "Old transcript",
      pinned: true
    })
  ];

  const nextHistory = upsertHistoryEntry(
    existingHistory,
    {
      title: "Updated Video",
      url: "https://youtube.com/watch?v=same",
      transcript: "Updated transcript"
    },
    "bullet-takeaways",
    {
      createId: () => "unused-id",
      savedAt: "2026-05-20T15:00:00.000Z"
    }
  );

  assert.equal(nextHistory.length, 1);
  assert.equal(nextHistory[0].id, "stable-id");
  assert.equal(nextHistory[0].pinned, true);
  assert.equal(nextHistory[0].transcript, "Updated transcript");
});

test("toggleHistoryPinned flips a single saved transcript", () => {
  const history = [createEntry(1), createEntry(2, { pinned: true })];
  const nextHistory = toggleHistoryPinned(history, "id-1");

  assert.equal(nextHistory[0].pinned, true);
  assert.equal(nextHistory[1].pinned, true);
});

test("clearUnpinnedHistory keeps only pinned transcripts", () => {
  const history = [createEntry(1), createEntry(2, { pinned: true }), createEntry(3)];
  const nextHistory = clearUnpinnedHistory(history);

  assert.deepEqual(nextHistory.map((entry) => entry.id), ["id-2"]);
});

test("sortHistoryForDisplay puts pinned entries first, then newest first", () => {
  const history = [
    createEntry(1, { savedAt: "2026-05-10T12:00:00.000Z" }),
    createEntry(2, { savedAt: "2026-05-11T12:00:00.000Z", pinned: true }),
    createEntry(3, { savedAt: "2026-05-12T12:00:00.000Z" }),
    createEntry(4, { savedAt: "2026-05-09T12:00:00.000Z", pinned: true })
  ];

  const nextHistory = sortHistoryForDisplay(history);

  assert.deepEqual(nextHistory.map((entry) => entry.id), ["id-2", "id-4", "id-3", "id-1"]);
});