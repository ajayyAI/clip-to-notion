# X to Notion Idea Saver

Chrome extension (Manifest V3) that adds a **Save to Notion** button on posts in `x.com`.

When you click it, the extension sends the post metadata to a Notion database and prevents duplicates by canonical post URL.

## What is included

- Button injection on X posts
- One-click save to Notion
- Duplicate detection (`Post URL`)
- Options page for token + database setup
- Connection test with schema checks
- Unit tests for shared parsing logic

## Required Notion database schema

Create a Notion database with these property names and types:

- `Title` (title)
- `Post URL` (url)
- `Author` (rich_text)
- `Content` (rich_text)
- `Posted At` (date)
- `Saved At` (date)
- `Source` (select)

## Setup

1. Create a Notion **internal integration** and copy its secret token.
2. Share your target database with that integration in Notion.
3. Load extension:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select this project folder
4. Open extension options and enter:
   - Integration token
   - Database ID
5. Click **Test connection**.

## Development

Run tests:

```bash
npm test
```

No build step is required for this MVP.
