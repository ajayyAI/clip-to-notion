importScripts("shared-core.js");

const CORE = self.X2NotionCore;

const DEFAULT_SETTINGS = {
  [CORE.STORAGE_KEYS.notionToken]: "",
  [CORE.STORAGE_KEYS.notionDatabaseId]: "",
  [CORE.STORAGE_KEYS.enabledOnX]: true
};

const REQUIRED_DATABASE_PROPERTIES = [
  "Title",
  "Post URL",
  "Author",
  "Content",
  "Posted At",
  "Saved At",
  "Source"
];

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const normalizedDatabaseId = CORE.normalizeDatabaseId(existing[CORE.STORAGE_KEYS.notionDatabaseId]) || "";
  await chrome.storage.sync.set({
    ...DEFAULT_SETTINGS,
    ...existing,
    [CORE.STORAGE_KEYS.notionDatabaseId]: normalizedDatabaseId
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        status: "error",
        code: "UNEXPECTED",
        message: error instanceof Error ? error.message : "Unexpected error"
      })
    );

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "SAVE_POST":
      return handleSavePost(message.payload);
    case "TEST_CONNECTION":
      return handleTestConnection(message.payload);
    case "GET_SETTINGS":
      return {
        status: "ok",
        settings: await getSettings()
      };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { status: "ok" };
    default:
      return {
        status: "error",
        code: "UNKNOWN_MESSAGE",
        message: "Unsupported message type."
      };
  }
}

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    [CORE.STORAGE_KEYS.notionToken]: settings[CORE.STORAGE_KEYS.notionToken] || "",
    [CORE.STORAGE_KEYS.notionDatabaseId]: CORE.normalizeDatabaseId(settings[CORE.STORAGE_KEYS.notionDatabaseId]) || "",
    [CORE.STORAGE_KEYS.enabledOnX]: settings[CORE.STORAGE_KEYS.enabledOnX] !== false
  };
}

function validateConfiguration(settings) {
  const notionToken = settings[CORE.STORAGE_KEYS.notionToken].trim();
  const notionDatabaseId = CORE.normalizeDatabaseId(settings[CORE.STORAGE_KEYS.notionDatabaseId]);

  if (!CORE.isLikelyNotionToken(notionToken) || !notionDatabaseId) {
    return {
      ok: false,
      status: "error",
      code: "NOT_CONFIGURED",
      message: "Notion token or database ID is missing."
    };
  }

  return {
    ok: true,
    notionToken,
    notionDatabaseId
  };
}

function validateIncomingPost(post) {
  const postUrl = CORE.normalizePostUrl(post?.postUrl || "");
  if (!postUrl) {
    return {
      ok: false,
      status: "error",
      code: "INVALID_POST_URL",
      message: "Could not parse a valid post URL."
    };
  }

  return {
    ok: true,
    postUrl,
    authorHandle: CORE.normalizeWhitespace(post?.authorHandle || ""),
    authorName: CORE.normalizeWhitespace(post?.authorName || ""),
    text: CORE.normalizeWhitespace(post?.text || ""),
    postedAt: CORE.normalizeISODate(post?.postedAt || ""),
    savedAt: CORE.normalizeISODate(post?.savedAt || "") || new Date().toISOString()
  };
}

async function handleTestConnection(payload) {
  const settings = await getSettings();
  const notionToken = (payload?.notionToken || settings[CORE.STORAGE_KEYS.notionToken] || "").trim();
  const notionDatabaseId = CORE.normalizeDatabaseId(
    payload?.notionDatabaseId || settings[CORE.STORAGE_KEYS.notionDatabaseId] || ""
  );

  if (!CORE.isLikelyNotionToken(notionToken) || !notionDatabaseId) {
    return {
      status: "error",
      code: "INVALID_SETTINGS",
      message: "Please provide a valid Notion token and database ID."
    };
  }

  try {
    const database = await notionFetch(`/databases/${notionDatabaseId}`, { method: "GET" }, notionToken);
    const databaseTitle = Array.isArray(database.title)
      ? database.title.map((part) => part.plain_text || "").join("").trim()
      : "";
    const missingProperties = REQUIRED_DATABASE_PROPERTIES.filter(
      (propertyName) => !Object.prototype.hasOwnProperty.call(database.properties || {}, propertyName)
    );

    return {
      status: "ok",
      databaseTitle: databaseTitle || "Untitled database",
      missingProperties
    };
  } catch (error) {
    return normalizeNotionError(error);
  }
}

async function handleSavePost(postPayload) {
  const settings = await getSettings();
  const config = validateConfiguration(settings);
  if (!config.ok) {
    return config;
  }

  const post = validateIncomingPost(postPayload);
  if (!post.ok) {
    return post;
  }

  try {
    const existing = await findExistingByPostUrl(config.notionToken, config.notionDatabaseId, post.postUrl);
    if (existing) {
      return {
        status: "already_saved",
        notionPageId: existing.id || null
      };
    }

    const created = await createPostPage(config.notionToken, config.notionDatabaseId, post);
    return {
      status: "saved",
      notionPageId: created.id
    };
  } catch (error) {
    return normalizeNotionError(error);
  }
}

async function findExistingByPostUrl(notionToken, databaseId, postUrl) {
  const response = await notionFetch(
    `/databases/${databaseId}/query`,
    {
      method: "POST",
      body: {
        filter: {
          property: "Post URL",
          url: {
            equals: postUrl
          }
        },
        page_size: 1
      }
    },
    notionToken
  );

  if (!Array.isArray(response.results) || response.results.length === 0) {
    return null;
  }
  return response.results[0];
}

async function createPostPage(notionToken, databaseId, post) {
  const authorLabel = CORE.buildAuthorLabel(post.authorHandle, post.authorName);

  const properties = {
    Title: {
      title: [
        {
          text: {
            content: CORE.buildTitle(post.text, post.authorHandle)
          }
        }
      ]
    },
    "Post URL": {
      url: post.postUrl
    },
    "Saved At": {
      date: {
        start: post.savedAt
      }
    },
    Source: {
      select: {
        name: "X"
      }
    }
  };

  if (authorLabel) {
    properties.Author = {
      rich_text: [
        {
          text: {
            content: CORE.truncate(authorLabel, 1800)
          }
        }
      ]
    };
  }

  if (post.text) {
    properties.Content = {
      rich_text: [
        {
          text: {
            content: CORE.truncate(post.text, 1800)
          }
        }
      ]
    };
  }

  if (post.postedAt) {
    properties["Posted At"] = {
      date: {
        start: post.postedAt
      }
    };
  }

  return notionFetch(
    "/pages",
    {
      method: "POST",
      body: {
        parent: {
          database_id: databaseId
        },
        properties
      }
    },
    notionToken
  );
}

async function notionFetch(path, requestOptions, notionToken, attempt) {
  const retryCount = attempt || 0;
  const response = await fetch(`${CORE.NOTION_API_BASE}${path}`, {
    method: requestOptions.method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": CORE.NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (response.status === 429 && retryCount < 1) {
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : 900;
    await delay(waitMs);
    return notionFetch(path, requestOptions, notionToken, retryCount + 1);
  }

  if (!response.ok) {
    const error = new Error(payload?.message || "Notion request failed.");
    error.name = "NotionApiError";
    error.status = response.status;
    error.notionCode = payload?.code || null;
    throw error;
  }

  return payload;
}

function normalizeNotionError(error) {
  if (error?.name === "NotionApiError") {
    if (error.status === 401) {
      return {
        status: "error",
        code: "NOTION_UNAUTHORIZED",
        message: "Notion token is invalid."
      };
    }
    if (error.status === 403) {
      return {
        status: "error",
        code: "NOTION_FORBIDDEN",
        message: "Share the database with your Notion integration first."
      };
    }
    if (error.status === 404) {
      return {
        status: "error",
        code: "NOTION_NOT_FOUND",
        message: "Notion database not found. Check the database ID."
      };
    }
    if (error.status === 429) {
      return {
        status: "error",
        code: "NOTION_RATE_LIMITED",
        message: "Notion is rate limiting requests. Please retry in a moment."
      };
    }
    return {
      status: "error",
      code: "NOTION_API_ERROR",
      message: error.message || "Notion API request failed."
    };
  }

  return {
    status: "error",
    code: "NETWORK_OR_UNKNOWN",
    message: error instanceof Error ? error.message : "Request failed unexpectedly."
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
