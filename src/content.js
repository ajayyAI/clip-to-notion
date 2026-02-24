(function initContentScript() {
  if (window.__x2notionContentScriptLoaded) {
    return;
  }
  window.__x2notionContentScriptLoaded = true;

  const CORE = window.X2NotionCore;
  if (!CORE) {
    return;
  }

  const SELECTORS = {
    article: "article",
    actionGroup: 'div[role="group"]',
    text: 'div[data-testid="tweetText"]',
    userName: 'div[data-testid="User-Name"]',
    statusLink: 'a[href*="/status/"]'
  };

  let scanTimer = null;
  let extensionEnabled = true;

  bootstrapSettings();
  observeDomChanges();

  function observeDomChanges() {
    const observer = new MutationObserver(() => {
      scheduleScan();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", scheduleScan);
  }

  function scheduleScan() {
    if (!extensionEnabled) {
      return;
    }
    if (scanTimer) {
      window.clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(scanForPosts, 180);
  }

  function scanForPosts() {
    const articles = document.querySelectorAll(SELECTORS.article);
    for (const article of articles) {
      injectButton(article);
    }
  }

  function injectButton(article) {
    if (!extensionEnabled) {
      return;
    }
    if (!(article instanceof HTMLElement)) {
      return;
    }
    if (article.querySelector(".x2n-save-wrap")) {
      return;
    }

    const actionGroup = article.querySelector(SELECTORS.actionGroup);
    if (!actionGroup) {
      return;
    }

    const postData = extractPostData(article);
    if (!postData || !postData.postUrl) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "x2n-save-wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "x2n-save-button";
    button.textContent = "Save to Notion";
    button.setAttribute("aria-label", "Save post to Notion");
    button.dataset.state = "idle";

    wrapper.appendChild(button);
    actionGroup.appendChild(wrapper);

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await saveCurrentPost(article, button);
    });
  }

  async function saveCurrentPost(article, button) {
    const postData = extractPostData(article);
    if (!postData || !postData.postUrl) {
      showToast("Could not parse this post.", "error");
      setButtonState(button, "error", "Parse failed");
      return;
    }

    setButtonState(button, "saving", "Saving...");

    try {
      const response = await sendRuntimeMessage({
        type: "SAVE_POST",
        payload: postData
      });

      if (response?.status === "saved") {
        setButtonState(button, "saved", "Saved");
        showToast("Saved to Notion.", "success");
        return;
      }

      if (response?.status === "already_saved") {
        setButtonState(button, "already", "Already saved");
        showToast("Post already exists in Notion.", "info");
        return;
      }

      const message = response?.message || "Could not save this post.";
      setButtonState(button, "error", "Error");
      showToast(message, "error");

      if (response?.code === "NOT_CONFIGURED") {
        await sendRuntimeMessage({ type: "OPEN_OPTIONS" }).catch(() => {
          /* no-op */
        });
      }
    } catch (error) {
      setButtonState(button, "error", "Error");
      showToast(error instanceof Error ? error.message : "Unexpected error", "error");
    }
  }

  function extractPostData(article) {
    const rawUrl = findCanonicalStatusUrl(article);
    const postUrl = CORE.normalizePostUrl(rawUrl || "");
    if (!postUrl) {
      return null;
    }

    const handleFromUrl = CORE.extractHandleFromPostUrl(postUrl) || "";
    const authorHandle = extractAuthorHandle(article) || handleFromUrl;
    const authorName = extractAuthorName(article);
    const textNode = article.querySelector(SELECTORS.text);
    const text = CORE.normalizeWhitespace(textNode ? textNode.innerText : "");
    const timeNode = article.querySelector("time");
    const postedAt = CORE.normalizeISODate(timeNode ? timeNode.getAttribute("datetime") : "");

    return {
      postUrl,
      authorHandle,
      authorName,
      text,
      postedAt,
      savedAt: new Date().toISOString()
    };
  }

  function findCanonicalStatusUrl(article) {
    const timeNode = article.querySelector("time");
    if (timeNode) {
      const timeLink = timeNode.closest('a[href*="/status/"]');
      if (timeLink && typeof timeLink.href === "string") {
        return timeLink.href;
      }
    }

    const links = article.querySelectorAll(SELECTORS.statusLink);
    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) {
        continue;
      }
      if (CORE.normalizePostUrl(link.href)) {
        return link.href;
      }
    }

    return null;
  }

  function extractAuthorHandle(article) {
    const userNameBlock = article.querySelector(SELECTORS.userName);
    if (!userNameBlock) {
      return "";
    }

    const profileLinks = userNameBlock.querySelectorAll('a[href^="/"]');
    for (const link of profileLinks) {
      const href = link.getAttribute("href");
      if (!href || href.includes("/status/")) {
        continue;
      }
      const match = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match) {
        return match[1];
      }
    }

    return "";
  }

  function extractAuthorName(article) {
    const userNameBlock = article.querySelector(SELECTORS.userName);
    if (!userNameBlock) {
      return "";
    }

    const spans = userNameBlock.querySelectorAll("span");
    for (const span of spans) {
      const value = CORE.normalizeWhitespace(span.textContent || "");
      if (!value) {
        continue;
      }
      if (!value.startsWith("@")) {
        return value;
      }
    }
    return "";
  }

  function setButtonState(button, state, label) {
    button.dataset.state = state;
    button.textContent = label;

    if (state === "saving") {
      button.disabled = true;
      return;
    }

    button.disabled = false;
  }

  async function bootstrapSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        enabledOnX: true
      });
      extensionEnabled = settings.enabledOnX !== false;
      if (extensionEnabled) {
        scheduleScan();
      } else {
        removeInjectedButtons();
      }
    } catch (_error) {
      extensionEnabled = true;
      scheduleScan();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.enabledOnX) {
        return;
      }
      extensionEnabled = changes.enabledOnX.newValue !== false;
      if (extensionEnabled) {
        scheduleScan();
      } else {
        removeInjectedButtons();
      }
    });
  }

  function removeInjectedButtons() {
    const wrappers = document.querySelectorAll(".x2n-save-wrap");
    for (const wrapper of wrappers) {
      wrapper.remove();
    }
  }

  function showToast(message, tone) {
    const existing = document.querySelector(".x2n-toast");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.className = "x2n-toast";
    toast.dataset.tone = tone || "info";
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 1900);
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }
})();
