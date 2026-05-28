(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.YTTA_EXPORTS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function slugifyTitle(title) {
    const normalized = typeof title === "string" ? title.toLowerCase() : "transcript";
    const slug = normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    return slug || "transcript";
  }

  function buildTranscriptMarkdown(entry) {
    const savedAt = typeof entry?.savedAt === "string" && entry.savedAt.trim() ? entry.savedAt : "Unknown";
    const title = typeof entry?.title === "string" && entry.title.trim() ? entry.title : "Untitled video";
    const url = typeof entry?.url === "string" && entry.url.trim() ? entry.url : "Unknown URL";
    const transcript = typeof entry?.transcript === "string" ? entry.transcript : "";

    return [
      `# ${title}`,
      "",
      `- URL: ${url}`,
      `- Saved: ${savedAt}`,
      "",
      "## Transcript",
      "",
      transcript
    ].join("\n");
  }

  function buildTranscriptExport(entry) {
    return {
      fileName: `${slugifyTitle(entry?.title)}.md`,
      mimeType: "text/markdown;charset=utf-8",
      content: buildTranscriptMarkdown(entry)
    };
  }

  return {
    buildTranscriptExport,
    buildTranscriptMarkdown,
    slugifyTitle
  };
});