(function initOptionsPage() {
  const CORE = window.X2NotionCore;
  if (!CORE) {
    return;
  }

  const form = document.getElementById("settingsForm");
  const tokenInput = document.getElementById("notionToken");
  const databaseIdInput = document.getElementById("notionDatabaseId");
  const enabledInput = document.getElementById("enabledOnX");
  const saveButton = document.getElementById("saveButton");
  const testButton = document.getElementById("testConnectionButton");
  const statusMessage = document.getElementById("statusMessage");

  loadInitialSettings();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSettings();
  });

  testButton.addEventListener("click", async () => {
    await testConnection();
  });

  async function loadInitialSettings() {
    const settings = await chrome.storage.sync.get({
      [CORE.STORAGE_KEYS.notionToken]: "",
      [CORE.STORAGE_KEYS.notionDatabaseId]: "",
      [CORE.STORAGE_KEYS.enabledOnX]: true
    });

    tokenInput.value = settings[CORE.STORAGE_KEYS.notionToken] || "";
    databaseIdInput.value = settings[CORE.STORAGE_KEYS.notionDatabaseId] || "";
    enabledInput.checked = settings[CORE.STORAGE_KEYS.enabledOnX] !== false;
  }

  async function saveSettings() {
    const notionToken = tokenInput.value.trim();
    const notionDatabaseId = CORE.normalizeDatabaseId(databaseIdInput.value);
    const enabledOnX = enabledInput.checked;

    if (!CORE.isLikelyNotionToken(notionToken)) {
      setStatus("Please paste a valid Notion integration token.", "error");
      return;
    }

    if (!notionDatabaseId) {
      setStatus("Please provide a valid Notion database ID.", "error");
      return;
    }

    saveButton.disabled = true;
    try {
      await chrome.storage.sync.set({
        [CORE.STORAGE_KEYS.notionToken]: notionToken,
        [CORE.STORAGE_KEYS.notionDatabaseId]: notionDatabaseId,
        [CORE.STORAGE_KEYS.enabledOnX]: enabledOnX
      });
      databaseIdInput.value = notionDatabaseId;
      setStatus("Settings saved.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save settings.", "error");
    } finally {
      saveButton.disabled = false;
    }
  }

  async function testConnection() {
    const notionToken = tokenInput.value.trim();
    const notionDatabaseId = CORE.normalizeDatabaseId(databaseIdInput.value);

    if (!CORE.isLikelyNotionToken(notionToken) || !notionDatabaseId) {
      setStatus("Enter token and database ID before testing.", "error");
      return;
    }

    testButton.disabled = true;
    setStatus("Testing connection...", "warning");

    try {
      const response = await sendRuntimeMessage({
        type: "TEST_CONNECTION",
        payload: {
          notionToken,
          notionDatabaseId
        }
      });

      if (response?.status !== "ok") {
        setStatus(response?.message || "Connection test failed.", "error");
        return;
      }

      const missing = Array.isArray(response.missingProperties) ? response.missingProperties : [];
      if (missing.length > 0) {
        setStatus(
          `Connected to "${response.databaseTitle}". Missing properties: ${missing.join(", ")}`,
          "warning"
        );
        return;
      }

      setStatus(`Connected to "${response.databaseTitle}". Schema looks good.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Connection test failed.", "error");
    } finally {
      testButton.disabled = false;
    }
  }

  function setStatus(message, tone) {
    statusMessage.textContent = message;
    statusMessage.dataset.tone = tone || "warning";
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
