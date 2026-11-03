# YouTube Transcript to AI

Chrome extension that grabs the transcript from the current YouTube video and opens it in ChatGPT, Claude, or Gemini.

## Features

- Pulls the transcript from the active `youtube.com/watch` page
- Adds an inline YouTube page button so you can send the current video without opening the popup
- Sends the transcript to ChatGPT, Claude, or Gemini
- Saves a recent transcript history so you can reuse a transcript later
- Lets you pin important transcripts so they stay beyond the rolling recent-history cap
- Lets you delete individual saved transcripts or clear all unpinned ones
- Lets you compare two saved transcripts in a single AI prompt
- Lets you export any saved transcript as a markdown file
- Supports prompt presets like short summary, detailed analysis, bullet takeaways, and custom
- Lets you choose between opening a new tab or a new popup window
- Supports a configurable prompt template with `{{title}}`, `{{url}}`, and `{{transcript}}`
- Optional auto-submit after the prompt is inserted
- Searchable transcript panel with timestamps that jump to the matching point in the video
- Timestamped transcripts in AI prompts and Markdown exports
- Optional automatic clicking of YouTube's available **Skip ad** button
- Optional SponsorBlock integration for sponsorships, intros, outros, self-promotion, and subscribe reminders, with **Undo** after a skip
- Handles navigation from the YouTube homepage without a full page reload
- Preserves existing AI drafts by opening another chat when the chosen tab is busy

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `E:\chrome_youtube_transcibe` folder

## Configure

1. Open the extension
2. Click **Open settings**
3. Choose ChatGPT, Claude, or Gemini
4. Choose the default prompt preset
5. Adjust the custom prompt template if needed
6. Optionally enable auto-submit
7. Optionally enable **Automatically click Skip ad** under YouTube playback
8. Optionally enable **SponsorBlock**, choose segment categories, and save. Chrome requests access to `sponsor.ajay.app` when this is enabled.

## Use

1. Open a YouTube video page
2. Make sure captions are available for that video
3. Choose a preset in the popup, or use one of the inline preset buttons on the YouTube page
4. Click **Send current video transcript**
5. Sign in to ChatGPT, Claude, or Gemini if the site asks for it
6. Reopen the popup later to resend a saved transcript, pin it, delete it, export it, clear unpinned history, or compare two saved transcripts
7. Click **Transcript** below the video to search captions. Click a result to jump to its timestamp.

AI delivery waits for confirmation that the prompt was inserted. If sign-in or loading takes longer than 45 seconds, sign in and resend from history. Auto-submit is attempted only while the inserted text remains unchanged; if a Send button is unavailable, submit the inserted prompt manually.

Both playback options are off by default. Automatic ad skipping clicks YouTube's Skip button once it becomes available; it does not block ad requests or bypass unskippable ads. SponsorBlock skips community-marked portions of the video itself. Missing data, unavailable service, live streams, and video-duration mismatches leave playback unchanged. **Undo** replays a skipped segment and excludes it from further skipping until you change videos.

## Development

Use Node.js 22 or later to run unit and service tests:

```bash
npm test
```

Run the browser smoke tests in a separate, temporary headless Chrome profile:

```bash
npm run test:browser
```

The browser tests exercise the production content scripts with a local YouTube-style DOM fixture and mocked service responses; they do not contact YouTube or AI services. Set `CHROME_PATH` if Chrome/Chromium is not installed in a standard location. This local harness disables the browser sandbox to support restricted test environments; it uses no personal profile. Live YouTube and AI layouts still need a manual check after updates.

To load changes, click **Reload** for the unpacked extension at `chrome://extensions`, then refresh existing YouTube and AI tabs. Chrome 111 or later is required.

## SponsorBlock data and privacy

Uses [SponsorBlock](https://sponsor.ajay.app/) contributor data under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). API documentation: [SponsorBlock API](https://wiki.sponsor.ajay.app/w/API_Docs). Segment data is filtered and normalized for playback; no submissions or votes are sent.

When SponsorBlock is enabled and its optional host permission is granted, lookups send the first four characters of the SHA-256 hash of the current video ID, plus selected categories. The service sees your IP address. Results are filtered to the current video locally and cached in memory for ten minutes. No SponsorBlock lookups are made while the option is disabled. Transcript extraction continues to use YouTube; transcripts are inserted into your selected AI site only when you send them.

## Notes

- The extension needs transcript data to be available on the video
- AI site layouts can change over time, so the input selectors may need updating if ChatGPT, Claude, or Gemini redesign their composer UI
