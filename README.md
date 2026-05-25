# YouTube Transcript to AI

Chrome extension that grabs the transcript from the current YouTube video and opens it in ChatGPT or Claude.

## Features

- Pulls the transcript from the active `youtube.com/watch` page
- Sends the transcript to either ChatGPT or Claude
- Lets you choose between opening a new tab or a new popup window
- Supports a configurable prompt template with `{{title}}`, `{{url}}`, and `{{transcript}}`
- Optional auto-submit after the prompt is inserted

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `E:\chrome_youtube_transcibe` folder

## Configure

1. Open the extension
2. Click **Open settings**
3. Choose ChatGPT or Claude
4. Adjust the prompt template if needed
5. Optionally enable auto-submit

## Use

1. Open a YouTube video page
2. Make sure captions are available for that video
3. Click **Send current video transcript**
4. Sign in to ChatGPT or Claude if the site asks for it

## Notes

- The extension needs transcript data to be available on the video
- AI site layouts can change over time, so the input selectors may need updating if ChatGPT or Claude redesign their composer UI
