(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YTTA_TRANSCRIPTS = api;
})(globalThis, () => {
  function normalizeCues(cues) {
    if (!Array.isArray(cues)) return [];
    return cues.filter((cue) => cue && Number.isFinite(cue.start) && cue.start >= 0 && typeof cue.text === "string")
      .map((cue) => ({ start: cue.start, duration: Math.max(0, Number(cue.duration) || 0), text: cue.text.replace(/\s+/g, " ").trim() }))
      .filter((cue) => cue.text).sort((a, b) => a.start - b.start);
  }
  function parseJson3Cues(text) {
    const data = JSON.parse(text);
    return normalizeCues((Array.isArray(data?.events) ? data.events : []).filter((event) => Array.isArray(event.segs)).map((event) => ({
      start: Number(event.tStartMs) / 1000,
      duration: Number(event.dDurationMs) / 1000,
      text: event.segs.map((seg) => typeof seg.utf8 === "string" ? seg.utf8 : "").join("")
    })));
  }
  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const rest = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
  }
  function cuesToText(cues, timestamps = false) {
    return normalizeCues(cues).map((cue) => `${timestamps ? `[${formatTime(cue.start)}] ` : ""}${cue.text}`).join("\n");
  }
  return { normalizeCues, parseJson3Cues, formatTime, cuesToText };
});
