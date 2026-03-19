# Clip to Notion

Chrome extension for saving X posts into a Notion database.

It injects a `Save idea` button into posts on `x.com`, writes the post URL to Notion, and avoids duplicate entries by checking the database before creating a new page.

## What it does

- Adds a save button to posts on `x.com`
- Saves the post into a Notion database with one click
- Deduplicates by canonical post URL
- Shows clear button states such as `Saving`, `Saved`, `Already saved`, and `Retry`
- Includes an options page for configuration and connection testing
- Validates the target Notion database schema before writes

## What gets saved

The extension writes a minimal record to Notion:

- `Title`: a fallback title such as `X post 1938273648273648`
- `Post URL`: canonical `x.com` post URL
- `Saved At`: timestamp for when the save happened
- `Posted At`: original post timestamp, if your database includes that optional property

It does not save full post text, media, or author metadata.

## Notion database schema

Required properties:

- `Title` with type `title`
- `Post URL` with type `url`
- `Saved At` with type `date`

Optional property:

- `Posted At` with type `date`

If a required property is missing or has the wrong type, the extension blocks saves and shows the problem in the options page.

## Setup

1. Create a Notion internal integration and copy its token.
2. Share your target database with that integration.
3. Load the extension in Chrome:
   `chrome://extensions` -> enable Developer mode -> `Load unpacked` -> select this repository.
4. Open the extension options page.
5. Paste your Notion token.
6. Paste either the Notion database ID or the full database URL.
7. Save settings and run `Test Connection`.

## Development

This repo has no build step. Load it directly as an unpacked extension.

Run tests with:

```bash
npm test
```

## Project structure

```text
.
├── manifest.json
├── src/
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── options.html
│   ├── options.css
│   ├── options.js
│   └── shared-core.js
├── tests/
│   └── shared-core.test.js
├── assets/icons/
└── docs/chrome-web-store/
```

Key files:

- `src/content.js`: injects the button into the X UI and sends save requests
- `src/background.js`: handles settings, Notion API requests, dedupe, and schema checks
- `src/shared-core.js`: shared parsing, normalization, and schema utilities
- `src/options.*`: extension settings UI

## Permissions

- `storage`: stores extension settings
- `https://x.com/*`: reads post data from X pages where the button is injected
- `https://api.notion.com/*`: sends requests to the Notion API

The Notion token is stored in `chrome.storage.local`. The database ID and the `enabledOnX` setting are stored in `chrome.storage.sync`.

## Chrome Web Store docs

Store submission material lives in `docs/chrome-web-store/`:

- `listing-copy.md`
- `privacy-policy.md`
- `permission-rationale.md`
- `submission-checklist.md`
