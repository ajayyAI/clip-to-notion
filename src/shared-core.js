(function attachSharedCore(rootFactory) {
  const target = typeof globalThis !== "undefined" ? globalThis : self;
  const api = rootFactory();
  target.X2NotionCore = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(function buildSharedCore() {
  const NOTION_API_BASE = "https://api.notion.com/v1";
  const NOTION_VERSION = "2022-06-28";

  const STORAGE_KEYS = {
    notionToken: "notionToken",
    notionDatabaseId: "notionDatabaseId",
    enabledOnX: "enabledOnX"
  };

  function normalizeWhitespace(input) {
    if (typeof input !== "string") {
      return "";
    }
    return input.replace(/\s+/g, " ").trim();
  }

  function truncate(input, maxLength) {
    const normalized = normalizeWhitespace(input);
    if (!normalized) {
      return "";
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, maxLength - 1).trimEnd() + "…";
  }

  function normalizePostUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
      return null;
    }

    let parsed;
    try {
      const maybeAbsolute = rawUrl.startsWith("/") ? `https://x.com${rawUrl}` : rawUrl;
      parsed = new URL(maybeAbsolute);
    } catch (_error) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== "x.com" && host !== "www.x.com" && host !== "twitter.com" && host !== "www.twitter.com") {
      return null;
    }

    const pathMatch = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (!pathMatch) {
      return null;
    }

    const handle = pathMatch[1];
    const statusId = pathMatch[2];
    return `https://x.com/${handle}/status/${statusId}`;
  }

  function extractHandleFromPostUrl(postUrl) {
    const normalized = normalizePostUrl(postUrl);
    if (!normalized) {
      return null;
    }
    const match = normalized.match(/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+$/);
    return match ? match[1] : null;
  }

  function normalizeISODate(rawValue) {
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
      return null;
    }
    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  function normalizeDatabaseId(rawValue) {
    if (typeof rawValue !== "string") {
      return null;
    }
    const input = rawValue.trim();
    if (!input) {
      return null;
    }

    const uuidPattern = /([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})/;
    const directMatch = input.match(uuidPattern);
    if (directMatch) {
      return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}-${directMatch[4]}-${directMatch[5]}`.toLowerCase();
    }

    try {
      const parsed = new URL(input);
      const pathPieces = parsed.pathname.split("/").filter(Boolean);
      for (const piece of pathPieces.reverse()) {
        const match = piece.match(uuidPattern);
        if (match) {
          return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`.toLowerCase();
        }
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function isLikelyNotionToken(rawValue) {
    if (typeof rawValue !== "string") {
      return false;
    }
    const value = rawValue.trim();
    return value.length >= 20;
  }

  function buildTitle(rawText, rawHandle) {
    const text = truncate(rawText, 80);
    if (text) {
      return text;
    }
    const handle = normalizeWhitespace(rawHandle).replace(/^@/, "");
    if (handle) {
      return `X post by @${handle}`;
    }
    return "Saved X post";
  }

  function buildAuthorLabel(rawHandle, rawName) {
    const handle = normalizeWhitespace(rawHandle).replace(/^@/, "");
    const name = normalizeWhitespace(rawName);
    if (name && handle) {
      return `${name} (@${handle})`;
    }
    if (handle) {
      return `@${handle}`;
    }
    return name;
  }

  return {
    NOTION_API_BASE,
    NOTION_VERSION,
    STORAGE_KEYS,
    normalizeWhitespace,
    truncate,
    normalizePostUrl,
    extractHandleFromPostUrl,
    normalizeISODate,
    normalizeDatabaseId,
    isLikelyNotionToken,
    buildTitle,
    buildAuthorLabel
  };
});
