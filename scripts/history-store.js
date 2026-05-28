(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.YTTA_HISTORY = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_HISTORY_ITEMS = 8;

  function isValidHistoryEntry(entry) {
    return (
      entry &&
      typeof entry.id === "string" &&
      typeof entry.title === "string" &&
      typeof entry.url === "string" &&
      typeof entry.transcript === "string"
    );
  }

  function sanitizeHistory(history) {
    if (!Array.isArray(history)) {
      return [];
    }

    return history.filter(isValidHistoryEntry).map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      transcript: entry.transcript,
      presetId: typeof entry.presetId === "string" ? entry.presetId : "",
      savedAt: typeof entry.savedAt === "string" ? entry.savedAt : "",
      pinned: Boolean(entry.pinned)
    }));
  }

  function applyHistoryLimit(history) {
    let unpinnedCount = 0;
    const nextHistory = [];

    for (const entry of sanitizeHistory(history)) {
      if (entry.pinned) {
        nextHistory.push(entry);
        continue;
      }

      if (unpinnedCount < MAX_HISTORY_ITEMS) {
        nextHistory.push(entry);
        unpinnedCount += 1;
      }
    }

    return nextHistory;
  }

  function sortHistoryForDisplay(history) {
    return [...sanitizeHistory(history)].sort((leftEntry, rightEntry) => {
      if (leftEntry.pinned !== rightEntry.pinned) {
        return leftEntry.pinned ? -1 : 1;
      }

      const leftSavedAt = Date.parse(leftEntry.savedAt || "") || 0;
      const rightSavedAt = Date.parse(rightEntry.savedAt || "") || 0;
      return rightSavedAt - leftSavedAt;
    });
  }

  function upsertHistoryEntry(history, payload, presetId, options = {}) {
    const normalizedHistory = sanitizeHistory(history);
    const existingEntry = normalizedHistory.find((entry) => entry.url === payload.url);
    const createId = typeof options.createId === "function" ? options.createId : () => String(Date.now());
    const savedAt = typeof options.savedAt === "string" ? options.savedAt : new Date().toISOString();
    const nextEntry = {
      id: existingEntry?.id || createId(),
      title: payload.title,
      url: payload.url,
      transcript: payload.transcript,
      presetId: typeof presetId === "string" ? presetId : existingEntry?.presetId || "",
      savedAt,
      pinned: Boolean(existingEntry?.pinned)
    };

    return applyHistoryLimit([
      nextEntry,
      ...normalizedHistory.filter((entry) => entry.url !== payload.url)
    ]);
  }

  function toggleHistoryPinned(history, historyId) {
    return sanitizeHistory(history).map((entry) =>
      entry.id === historyId ? { ...entry, pinned: !entry.pinned } : entry
    );
  }

  function deleteHistoryEntry(history, historyId) {
    return sanitizeHistory(history).filter((entry) => entry.id !== historyId);
  }

  function clearUnpinnedHistory(history) {
    return sanitizeHistory(history).filter((entry) => entry.pinned);
  }

  return {
    MAX_HISTORY_ITEMS,
    clearUnpinnedHistory,
    deleteHistoryEntry,
    sanitizeHistory,
    sortHistoryForDisplay,
    toggleHistoryPinned,
    upsertHistoryEntry
  };
});