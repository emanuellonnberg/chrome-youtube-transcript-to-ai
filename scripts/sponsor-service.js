(() => {
  const cache = new Map();
  const ORIGINS = { origins: ["https://sponsor.ajay.app/*"] };
  async function getSegments(videoId) {
    if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("Invalid video ID.");
    const settings = YTTA_PROMPTS.normalizeSettings(await chrome.storage.sync.get(null));
    if (!settings.sponsorBlockEnabled) return [];
    if (!await chrome.permissions.contains(ORIGINS)) throw new Error("Allow SponsorBlock access in extension settings.");
    const categories = settings.sponsorCategories;
    if (!categories.length) return [];
    const key = `${videoId}:${[...categories].sort().join(",")}`;
    if (cache.has(key) && cache.get(key).expiresAt > Date.now()) return cache.get(key).promise;
    const promise = (async () => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId));
      const prefix = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 4);
      const url = new URL(`https://sponsor.ajay.app/api/skipSegments/${prefix}`);
      url.searchParams.set("categories", JSON.stringify(categories));
      url.searchParams.set("actionTypes", '["skip"]');
      const response = await fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`SponsorBlock unavailable (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Invalid SponsorBlock response.");
      return YTTA_PLAYBACK.normalizeSegments(data.find((video) => video.videoID === videoId)?.segments, categories);
    })();
    cache.set(key, { promise, expiresAt: Date.now() + 600000 });
    while (cache.size > 20) cache.delete(cache.keys().next().value);
    try { return await promise; } catch (error) { cache.delete(key); throw error; }
  }
  globalThis.YTTA_SPONSORS = { getSegments };
})();
