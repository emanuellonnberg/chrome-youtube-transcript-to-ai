# YouTube Transcript to AI

Chrome extension that grabs the transcript from the current YouTube video and opens it in ChatGPT, Claude, or Gemini.

## Features

- Pulls the transcript from the active `youtube.com/watch` page
- Adds an inline YouTube page button so you can send the current video without opening the popup
- Sends the transcript to ChatGPT, Claude, or Gemini
- Supports prompt presets like short summary, detailed analysis, bullet takeaways, and custom
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
3. Choose ChatGPT, Claude, or Gemini
4. Choose the default prompt preset
5. Adjust the custom prompt template if needed
6. Optionally enable auto-submit

## Use

1. Open a YouTube video page
2. Make sure captions are available for that video
3. Choose a preset in the popup, or use one of the inline preset buttons on the YouTube page
4. Click **Send current video transcript**
5. Sign in to ChatGPT, Claude, or Gemini if the site asks for it

## Notes

- The extension needs transcript data to be available on the video
- AI site layouts can change over time, so the input selectors may need updating if ChatGPT, Claude, or Gemini redesign their composer UI
