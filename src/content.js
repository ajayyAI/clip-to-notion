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

  const STATE_RESET_MS = 5000;

  const articleByButton = new WeakMap();
  const stateByPostId = new Map();
  const pendingArticles = new Set();

  let extensionEnabled = true;
  let flushTimer = null;

  bootstrapSettings();
  observeChanges();
  queueAllArticles();

  function observeChanges() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          queueArticlesFromNode(node);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", queueAllArticles);
  }

  function queueArticlesFromNode(node) {
    if (!(node instanceof Element)) {
      return;
    }

    if (node.matches(SELECTORS.article)) {
      pendingArticles.add(node);
    }

    const nestedArticles = node.querySelectorAll(SELECTORS.article);
    for (const article of nestedArticles) {
      pendingArticles.add(article);
    }

    scheduleFlush();
  }

  function queueAllArticles() {
    if (!extensionEnabled) {
      return;
    }
    const articles = document.querySelectorAll(SELECTORS.article);
    for (const article of articles) {
      pendingArticles.add(article);
    }
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }
    flushTimer = window.setTimeout(flushPendingArticles, 120);
  }

  function flushPendingArticles() {
    flushTimer = null;
    if (!extensionEnabled) {
      pendingArticles.clear();
      return;
    }

    for (const article of pendingArticles) {
      injectOrUpdateButton(article);
    }
    pendingArticles.clear();
  }

  function injectOrUpdateButton(article) {
    if (!(article instanceof HTMLElement)) {
      return;
    }

    const actionGroup = article.querySelector(SELECTORS.actionGroup);
    if (!actionGroup) {
      return;
    }

    const payload = extractPostData(article);
    if (!payload || !payload.postUrl) {
      return;
    }

    let wrapper = article.querySelector(".x2n-save-wrap");
    let button;
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "x2n-save-wrap";

      button = document.createElement("button");
      button.type = "button";
      button.className = "x2n-save-button";
      button.dataset.state = "idle";
      button.setAttribute("aria-label", "Save post idea to Notion");
      button.innerHTML =
        '<span class="x2n-save-icon" aria-hidden="true">+</span><span class="x2n-save-label">Save idea</span>';

      wrapper.appendChild(button);
      actionGroup.appendChild(wrapper);
      articleByButton.set(button, article);

      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await saveArticle(button);
      });
    } else {
      button = wrapper.querySelector(".x2n-save-button");
      if (!button) {
        return;
      }
    }

    articleByButton.set(button, article);
    button.dataset.postId = payload.postId;
    applyCachedState(button, payload.postId);
  }

  function applyCachedState(button, postId) {
    const cached = stateByPostId.get(postId);
    if (!cached) {
      setButtonState(button, "idle", "Save idea");
      return;
    }
    if (cached.expiresAt < Date.now()) {
      stateByPostId.delete(postId);
      setButtonState(button, "idle", "Save idea");
      return;
    }
    setButtonState(button, cached.state, cached.label);
  }

  async function saveArticle(button) {
    if (button.dataset.state === "saving") {
      return;
    }

    const article = articleByButton.get(button);
    if (!article) {
      return;
    }

    const payload = extractPostData(article);
    if (!payload || !payload.postUrl) {
      setButtonState(button, "error", "Parse failed");
      showToast("Could not parse this post.", "error");
      return;
    }

    setButtonState(button, "saving", "Saving");

    try {
      const response = await sendRuntimeMessage({
        type: "SAVE_POST",
        payload
      });

      if (response?.status === "saved") {
        cachePostState(payload.postId, "saved", "Saved");
        setButtonState(button, "saved", "Saved");
        scheduleStateReset(button, payload.postId);
        showToast("Saved to Notion.", "success");
        return;
      }

      if (response?.status === "already_saved") {
        cachePostState(payload.postId, "already", "Already saved");
        setButtonState(button, "already", "Already saved");
        scheduleStateReset(button, payload.postId);
        showToast("Already in your Notion database.", "info");
        return;
      }

      setButtonState(button, "error", "Retry");
      showToast(response?.message || "Could not save this post.", "error");

      if (response?.code === "NOT_CONFIGURED") {
        await sendRuntimeMessage({ type: "OPEN_OPTIONS" }).catch(() => {
          /* no-op */
        });
      }
    } catch (error) {
      setButtonState(button, "error", "Retry");
      showToast(error instanceof Error ? error.message : "Unexpected error.", "error");
    }
  }

  function cachePostState(postId, state, label) {
    stateByPostId.set(postId, {
      state,
      label,
      expiresAt: Date.now() + STATE_RESET_MS
    });
  }

  function scheduleStateReset(button, postId) {
    window.setTimeout(() => {
      const current = stateByPostId.get(postId);
      if (!current || current.expiresAt > Date.now()) {
        return;
      }
      stateByPostId.delete(postId);
      if (button.dataset.postId === postId && button.dataset.state !== "saving") {
        setButtonState(button, "idle", "Save idea");
      }
    }, STATE_RESET_MS + 40);
  }

  function extractPostData(article) {
    const postUrl = CORE.normalizePostUrl(findCanonicalStatusUrl(article) || "");
    const postId = CORE.extractStatusIdFromPostUrl(postUrl || "");
    if (!postUrl || !postId) {
      return null;
    }

    const authorHandle = extractAuthorHandle(article) || CORE.extractHandleFromPostUrl(postUrl) || "";
    const authorName = extractAuthorName(article);
    const text = extractPrimaryPostText(article);
    const postedAt = CORE.normalizeISODate(extractPostDatetime(article) || "");

    return {
      postId,
      postUrl,
      authorHandle,
      authorName,
      text,
      postedAt,
      savedAt: new Date().toISOString()
    };
  }

  function findCanonicalStatusUrl(article) {
    const timeLinkCandidates = article.querySelectorAll('a[href*="/status/"] time');
    for (const timeElement of timeLinkCandidates) {
      const link = timeElement.closest('a[href*="/status/"]');
      if (link instanceof HTMLAnchorElement && link.closest(SELECTORS.article) === article) {
        const normalized = CORE.normalizePostUrl(link.href);
        if (normalized) {
          return normalized;
        }
      }
    }

    const links = article.querySelectorAll(SELECTORS.statusLink);
    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) {
        continue;
      }
      const href = link.href || link.getAttribute("href") || "";
      const normalized = CORE.normalizePostUrl(href);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  function extractPostDatetime(article) {
    const timeElement = article.querySelector("time");
    if (!(timeElement instanceof HTMLTimeElement)) {
      return "";
    }
    return timeElement.getAttribute("datetime") || "";
  }

  function extractPrimaryPostText(article) {
    const textNodes = Array.from(article.querySelectorAll(SELECTORS.text));
    if (textNodes.length === 0) {
      return "";
    }

    let bestNode = textNodes[0];
    let bestDepth = depthFromAncestor(article, bestNode);

    for (let index = 1; index < textNodes.length; index += 1) {
      const candidate = textNodes[index];
      const depth = depthFromAncestor(article, candidate);
      if (depth < bestDepth) {
        bestNode = candidate;
        bestDepth = depth;
      }
    }

    return CORE.normalizeWhitespace(bestNode.innerText || "");
  }

  function depthFromAncestor(ancestor, node) {
    let depth = 0;
    let current = node;
    while (current && current !== ancestor) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
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
      if (!value || value.startsWith("@")) {
        continue;
      }
      return value;
    }
    return "";
  }

  function setButtonState(button, state, label) {
    button.dataset.state = state;

    const labelNode = button.querySelector(".x2n-save-label");
    if (labelNode) {
      labelNode.textContent = label;
    } else {
      button.textContent = label;
    }

    button.disabled = state === "saving";
  }

  async function bootstrapSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        [CORE.STORAGE_KEYS.enabledOnX]: true
      });
      extensionEnabled = settings[CORE.STORAGE_KEYS.enabledOnX] !== false;
    } catch (_error) {
      extensionEnabled = true;
    }

    if (!extensionEnabled) {
      removeInjectedButtons();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes[CORE.STORAGE_KEYS.enabledOnX]) {
        return;
      }

      extensionEnabled = changes[CORE.STORAGE_KEYS.enabledOnX].newValue !== false;
      if (extensionEnabled) {
        queueAllArticles();
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
    pendingArticles.clear();
  }

  function showToast(message, tone) {
    const existing = document.querySelector(".x2n-toast");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.className = "x2n-toast";
    toast.dataset.tone = tone || "info";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 2300);
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
