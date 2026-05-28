const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTranscriptExport,
  buildTranscriptMarkdown,
  slugifyTitle
} = require("../scripts/export-utils.js");

test("slugifyTitle creates a stable filename-friendly slug", () => {
  assert.equal(slugifyTitle("A/B Testing: What Actually Works?"), "a-b-testing-what-actually-works");
  assert.equal(slugifyTitle("   "), "transcript");
});

test("buildTranscriptMarkdown formats transcript metadata and body", () => {
  const markdown = buildTranscriptMarkdown({
    title: "Deep Dive",
    url: "https://youtube.com/watch?v=123",
    savedAt: "2026-05-27T09:00:00.000Z",
    transcript: "Line one\nLine two"
  });

  assert.match(markdown, /^# Deep Dive/m);
  assert.match(markdown, /- URL: https:\/\/youtube.com\/watch\?v=123/);
  assert.match(markdown, /## Transcript/);
  assert.match(markdown, /Line one\nLine two/);
});

test("buildTranscriptExport returns markdown content with a markdown filename", () => {
  const exported = buildTranscriptExport({
    title: "My Saved Video",
    url: "https://youtube.com/watch?v=123",
    transcript: "Transcript body"
  });

  assert.equal(exported.fileName, "my-saved-video.md");
  assert.equal(exported.mimeType, "text/markdown;charset=utf-8");
  assert.match(exported.content, /^# My Saved Video/m);
});