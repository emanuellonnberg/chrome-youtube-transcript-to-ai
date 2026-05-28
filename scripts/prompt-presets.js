(function () {
  const PROMPT_PRESETS = [
    {
      id: "short-summary",
      label: "Short summary",
      template: [
        "Summarize this YouTube video clearly and briefly.",
        "Title: {{title}}",
        "URL: {{url}}",
        "",
        "Requirements:",
        "- Write 5 concise bullet points",
        "- Focus on the main ideas only",
        "- End with one sentence on why it matters",
        "",
        "Transcript:",
        "{{transcript}}"
      ].join("\n")
    },
    {
      id: "detailed-analysis",
      label: "Detailed analysis",
      template: [
        "Analyze this YouTube video in depth.",
        "Title: {{title}}",
        "URL: {{url}}",
        "",
        "Requirements:",
        "- Start with a short overview",
        "- Break the content into themes or sections",
        "- Highlight key arguments, evidence, and examples",
        "- Call out assumptions, risks, or weaknesses if relevant",
        "- Finish with the most important takeaways",
        "",
        "Transcript:",
        "{{transcript}}"
      ].join("\n")
    },
    {
      id: "bullet-takeaways",
      label: "Bullet takeaways",
      template: [
        "Turn this YouTube transcript into actionable takeaways.",
        "Title: {{title}}",
        "URL: {{url}}",
        "",
        "Requirements:",
        "- Create a clean bullet list",
        "- Keep each bullet specific and useful",
        "- Group related ideas when helpful",
        "",
        "Transcript:",
        "{{transcript}}"
      ].join("\n")
    },
    {
      id: "action-items",
      label: "Action items",
      template: [
        "Extract concrete action items from this YouTube transcript.",
        "Title: {{title}}",
        "URL: {{url}}",
        "",
        "Requirements:",
        "- List practical next steps",
        "- Make each action item clear and specific",
        "- Include who should do it when that can be inferred",
        "",
        "Transcript:",
        "{{transcript}}"
      ].join("\n")
    },
    {
      id: "beginner-friendly",
      label: "Explain for beginners",
      template: [
        "Explain this YouTube video for a beginner.",
        "Title: {{title}}",
        "URL: {{url}}",
        "",
        "Requirements:",
        "- Use simple language",
        "- Define jargon briefly",
        "- Use a friendly teaching style",
        "- End with 3 key things to remember",
        "",
        "Transcript:",
        "{{transcript}}"
      ].join("\n")
    },
    {
      id: "custom",
      label: "Custom",
      template: [
        "Please work with the following YouTube transcript.",
        "Video title: {{title}}",
        "Video URL: {{url}}",
        "",
        "{{transcript}}"
      ].join("\n")
    }
  ];

  const PRESET_MAP = Object.fromEntries(PROMPT_PRESETS.map((preset) => [preset.id, preset]));
  const QUICK_PRESET_IDS = ["short-summary", "detailed-analysis", "bullet-takeaways"];
  const DEFAULT_SETTINGS = {
    target: "chatgpt",
    openMode: "new-tab",
    reuseExistingChat: false,
    autoSubmit: false,
    defaultPreset: "short-summary",
    promptTemplate: PRESET_MAP.custom.template
  };

  function normalizeSettings(stored = {}) {
    const defaultPreset = PRESET_MAP[stored.defaultPreset]
      ? stored.defaultPreset
      : DEFAULT_SETTINGS.defaultPreset;
    const promptTemplate =
      typeof stored.promptTemplate === "string" && stored.promptTemplate.trim()
        ? stored.promptTemplate
        : DEFAULT_SETTINGS.promptTemplate;

    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      reuseExistingChat: Boolean(stored.reuseExistingChat),
      defaultPreset,
      promptTemplate
    };
  }

  function getPromptPresetDefinitions() {
    return PROMPT_PRESETS.map((preset) => ({ ...preset }));
  }

  function getQuickPresetDefinitions() {
    return QUICK_PRESET_IDS.map((id) => ({ ...PRESET_MAP[id] }));
  }

  function getPromptPreset(id) {
    return PRESET_MAP[id] || PRESET_MAP[DEFAULT_SETTINGS.defaultPreset];
  }

  function getPromptPresetLabel(id) {
    return getPromptPreset(id).label;
  }

  function resolvePromptTemplate(settings, presetId) {
    const normalized = normalizeSettings(settings);
    const resolvedPresetId = PRESET_MAP[presetId] ? presetId : normalized.defaultPreset;

    if (resolvedPresetId === "custom") {
      return normalized.promptTemplate;
    }

    return getPromptPreset(resolvedPresetId).template;
  }

  globalThis.YTTA_PROMPTS = {
    DEFAULT_SETTINGS,
    getPromptPreset,
    getPromptPresetDefinitions,
    getPromptPresetLabel,
    getQuickPresetDefinitions,
    normalizeSettings,
    resolvePromptTemplate
  };
})();
