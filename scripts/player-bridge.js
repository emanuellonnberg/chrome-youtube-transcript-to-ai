// This small MAIN-world bridge exposes data only, never extension capabilities.
(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (request?.type !== "YTTA_PLAYER_REQUEST" || typeof request.id !== "string" || request.id.length > 100) return;
    const videoId = new URLSearchParams(location.search).get("v");
    if (location.pathname !== "/watch" || request.videoId !== videoId) return;
    let response;
    try {
      response = document.getElementById("movie_player")?.getPlayerResponse?.();
      if (response?.videoDetails?.videoId !== videoId) response = window.ytInitialPlayerResponse;
      if (response?.videoDetails?.videoId !== videoId) response = null;
      const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      window.postMessage({
        type: "YTTA_PLAYER_RESPONSE", id: request.id,
        playerResponse: response ? {
          videoDetails: { videoId, title: String(response.videoDetails.title || "") },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks.map((track) => ({
            baseUrl: String(track.baseUrl || ""), languageCode: String(track.languageCode || ""),
            kind: String(track.kind || "")
          })) } }
        } : null
      }, location.origin);
    } catch {
      window.postMessage({ type: "YTTA_PLAYER_RESPONSE", id: request.id, playerResponse: null }, location.origin);
    }
  });
})();
