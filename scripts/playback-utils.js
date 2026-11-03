(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTTA_PLAYBACK = api;
})(globalThis, () => {
  const CATEGORIES = ["sponsor", "intro", "outro", "selfpromo", "interaction"];
  function normalizeSegments(segments, categories = CATEGORIES) {
    if (!Array.isArray(segments)) return [];
    return segments.filter((item) => item && item.actionType === "skip" && categories.includes(item.category) &&
      typeof item.UUID === "string" && Array.isArray(item.segment) && item.segment.length === 2 &&
      item.segment.every(Number.isFinite) && item.segment[0] >= 0 && item.segment[1] > item.segment[0])
      .map((item) => ({ id: item.UUID, category: item.category, start: item.segment[0], end: item.segment[1],
        videoDuration: Number.isFinite(item.videoDuration) ? item.videoDuration : 0 }))
      .sort((a, b) => a.start - b.start);
  }
  function findSkip(segments, time, duration, ignored = new Set()) {
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return null;
    const valid = segments.filter((segment) => !ignored.has(segment.id) && segment.end <= duration &&
      (!segment.videoDuration || Math.abs(segment.videoDuration - duration) <= 2));
    const first = valid.find((segment) => time >= segment.start && time < segment.end);
    if (!first) return null;
    const result = { start: first.start, end: first.end, ids: [first.id], category: first.category };
    for (const segment of valid) {
      if (segment.id !== first.id && segment.start <= result.end && segment.end >= result.start) {
        result.end = Math.max(result.end, segment.end);
        result.ids.push(segment.id);
      }
    }
    return result;
  }
  return { CATEGORIES, normalizeSegments, findSkip };
});
