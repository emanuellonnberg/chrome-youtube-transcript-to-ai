(() => {
  let settings = YTTA_PROMPTS.normalizeSettings();
  let currentVideoId = null;
  let generation = 0;
  let panel = null;
  let cues = [];
  let panelLoading = false;
  let searchTimer = null;
  let rowLimit = 200;
  let playbackTimer = null;
  let player = null;
  let video = null;
  let playerObserver = null;
  let playbackCheckTimer = null;
  let segments = [];
  let sponsorStatus = "";
  let ignored = new Set();
  let notice = null;
  let noticeTimer = null;
  let sponsorRequest = 0;
  const adClickTimes = new WeakMap();

  function onWatchPage() { return location.pathname === "/watch" && Boolean(getCurrentVideoId()); }
  function adIsPlaying() { return player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting"); }
  function setPanelStatus(message) {
    if (panel) panel.querySelector('[data-role="panel-status"]').textContent = message;
  }
  function showNotice(message, undo = null) {
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = document.createElement("div");
    notice.id = "ytta-playback-notice";
    notice.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = message;
    notice.appendChild(text);
    if (undo) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Undo";
      button.addEventListener("click", () => { undo(); notice?.remove(); });
      notice.appendChild(button);
    }
    document.body.appendChild(notice);
    noticeTimer = setTimeout(() => notice?.remove(), 10000);
  }

  function ensurePanel() {
    const root = document.getElementById("ytta-inline-actions");
    if (!root) return null;
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "ytta-transcript-panel";
      panel.setAttribute("aria-label", "Video transcript");
      panel.hidden = true;
      panel.innerHTML = `
        <div class="ytta-panel-heading"><strong>Transcript</strong><button type="button" data-role="close">Close</button></div>
        <label class="ytta-search-label">Search transcript<input type="search" placeholder="Find a word or phrase" data-role="search"></label>
        <p data-role="panel-status" role="status" aria-live="polite"></p>
        <button type="button" data-role="retry" hidden>Retry transcript</button>
        <div data-role="cues" class="ytta-cues"></div>
        <button type="button" data-role="more" hidden>Show more matches</button>`;
      panel.querySelector('[data-role="close"]').addEventListener("click", () => {
        panel.hidden = true;
        root.querySelector('[data-role="transcript"]')?.setAttribute("aria-expanded", "false");
        root.querySelector('[data-role="transcript"]')?.focus();
      });
      panel.querySelector('[data-role="search"]').addEventListener("input", () => {
        clearTimeout(searchTimer);
        rowLimit = 200;
        searchTimer = setTimeout(renderCues, 120);
      });
      panel.querySelector('[data-role="retry"]').addEventListener("click", () => { void loadTranscript(); });
      panel.querySelector('[data-role="more"]').addEventListener("click", () => { rowLimit += 200; renderCues(); });
    }
    if (root.nextElementSibling !== panel) root.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function renderCues() {
    if (!panel || panel.hidden || panelLoading) return;
    const query = panel.querySelector('[data-role="search"]').value.trim().toLocaleLowerCase();
    const matches = cues.filter((cue) => cue.text.toLocaleLowerCase().includes(query));
    const fragment = document.createDocumentFragment();
    for (const cue of matches.slice(0, rowLimit)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ytta-cue";
      const time = document.createElement("span");
      time.className = "ytta-cue-time";
      time.textContent = YTTA_TRANSCRIPTS.formatTime(cue.start);
      const text = document.createElement("span");
      text.textContent = cue.text;
      row.append(time, text);
      row.addEventListener("click", () => {
        refreshPlayer();
        if (adIsPlaying()) { setPanelStatus("Wait until the ad finishes to jump to a timestamp."); return; }
        if (!video || !Number.isFinite(video.duration)) { setPanelStatus("Start the video, then try the timestamp again."); return; }
        video.currentTime = Math.min(cue.start, video.duration);
        setPanelStatus(`Jumped to ${YTTA_TRANSCRIPTS.formatTime(cue.start)}.`);
      });
      fragment.appendChild(row);
    }
    panel.querySelector('[data-role="cues"]').replaceChildren(fragment);
    panel.querySelector('[data-role="more"]').hidden = matches.length <= rowLimit;
    setPanelStatus(`${matches.length} ${query ? "matching" : "transcript"} lines${matches.length > rowLimit ? `; showing ${rowLimit}` : ""}. Click a timestamp to jump.`);
  }

  async function loadTranscript() {
    if (panelLoading || !panel) return;
    const token = generation;
    const activePanel = panel;
    panelLoading = true;
    activePanel.querySelector('[data-role="retry"]').hidden = true;
    setPanelStatus("Loading transcript… Start playback if captions have not loaded yet.");
    try {
      const payload = await extractTranscriptPayload();
      if (generation !== token || panel !== activePanel) return;
      cues = payload.cues;
      panelLoading = false;
      renderCues();
    } catch (error) {
      if (generation !== token || panel !== activePanel) return;
      panelLoading = false;
      setPanelStatus(error.message || "Could not load the transcript.");
      activePanel.querySelector('[data-role="retry"]').hidden = false;
    }
  }

  function queuePlaybackCheck() {
    if (playbackCheckTimer !== null) return;
    playbackCheckTimer = setTimeout(() => { playbackCheckTimer = null; checkPlayback(); }, 100);
  }
  function refreshPlayer() {
    const nextPlayer = onWatchPage() ? document.getElementById("movie_player") : null;
    const nextVideo = nextPlayer?.querySelector("video") || null;
    if (nextPlayer !== player) {
      playerObserver?.disconnect();
      player = nextPlayer;
      if (player) {
        playerObserver = new MutationObserver(queuePlaybackCheck);
        playerObserver.observe(player, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
      }
    }
    if (nextVideo !== video) {
      video?.removeEventListener("timeupdate", checkPlayback);
      video?.removeEventListener("seeking", checkPlayback);
      video = nextVideo;
      video?.addEventListener("timeupdate", checkPlayback);
      video?.addEventListener("seeking", checkPlayback);
    }
  }
  function checkPlayback() {
    if (!hasExtensionContext()) { stopPlayback(); return; }
    if (!onWatchPage() || getCurrentVideoId() !== currentVideoId) return;
    refreshPlayer();
    if (adIsPlaying()) {
      if (settings.autoSkipAds) {
        const skip = player.querySelector(".ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button");
        if (skip && !skip.disabled && skip.getAttribute("aria-disabled") !== "true" && skip.getClientRects().length &&
          Date.now() - (adClickTimes.get(skip) || 0) >= 1000) {
          adClickTimes.set(skip, Date.now());
          skip.click();
        }
      }
      return;
    }
    if (!settings.sponsorBlockEnabled || !video || video.paused || video.seeking) return;
    const skip = YTTA_PLAYBACK.findSkip(segments, video.currentTime, video.duration, ignored);
    if (!skip) return;
    const originalTime = video.currentTime;
    const token = generation;
    skip.ids.forEach((id) => ignored.add(id));
    video.currentTime = skip.end;
    showNotice(`Skipped ${skip.category} (${YTTA_TRANSCRIPTS.formatTime(skip.start)}–${YTTA_TRANSCRIPTS.formatTime(skip.end)}) · SponsorBlock`, () => {
      if (generation !== token || adIsPlaying() || !video) return;
      video.currentTime = originalTime;
    });
  }
  async function loadSponsors() {
    const request = ++sponsorRequest;
    const videoId = currentVideoId;
    segments = [];
    sponsorStatus = "";
    if (!onWatchPage() || !settings.sponsorBlockEnabled) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "getSponsorSegments", videoId });
      if (request !== sponsorRequest || videoId !== currentVideoId) return;
      if (!response?.ok) throw new Error(response?.error || "SponsorBlock unavailable.");
      segments = Array.isArray(response.segments) ? response.segments : [];
      sponsorStatus = segments.length ? `${segments.length} SponsorBlock segments loaded.` : "No SponsorBlock segments found for this video.";
      showNotice(sponsorStatus);
    } catch (error) {
      if (request === sponsorRequest && videoId === currentVideoId) showNotice(error.message || "SponsorBlock unavailable. Playback continues normally.");
    }
  }
  function stopPlayback() {
    clearInterval(playbackTimer);
    playbackTimer = null;
    clearTimeout(playbackCheckTimer);
    playbackCheckTimer = null;
    playerObserver?.disconnect();
    video?.removeEventListener("timeupdate", checkPlayback);
    video?.removeEventListener("seeking", checkPlayback);
    player = null;
    video = null;
  }
  function navigate() {
    const nextId = onWatchPage() ? getCurrentVideoId() : null;
    if (nextId === currentVideoId) return;
    currentVideoId = nextId;
    generation++;
    sponsorRequest++;
    panel?.remove();
    panel = null;
    cues = [];
    panelLoading = false;
    ignored = new Set();
    notice?.remove();
    clearTimeout(noticeTimer);
    clearTimeout(searchTimer);
    stopPlayback();
    if (nextId) {
      refreshPlayer();
      playbackTimer = setInterval(checkPlayback, 1000);
      void loadSponsors();
    }
  }
  document.addEventListener("ytta-toggle-transcript", () => {
    if (!onWatchPage()) return;
    navigate();
    if (!ensurePanel()) return;
    panel.hidden = !panel.hidden;
    document.querySelector('#ytta-inline-actions [data-role="transcript"]')?.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      if (!cues.length) void loadTranscript(); else renderCues();
      panel.querySelector('[data-role="search"]').focus();
    }
  });
  window.addEventListener("yt-navigate-finish", navigate);
  window.addEventListener("yt-page-data-updated", navigate);
  window.addEventListener("popstate", navigate);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    settings = YTTA_PROMPTS.normalizeSettings({ ...settings, ...Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])) });
    if (changes.sponsorBlockEnabled || changes.sponsorCategories) void loadSponsors();
    queuePlaybackCheck();
  });
  void chrome.storage.sync.get(null).then((stored) => { settings = YTTA_PROMPTS.normalizeSettings(stored); navigate(); })
    .catch(() => navigate());
})();
