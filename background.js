// Function to apply favicon
function applyFavicon(websiteUrl, newIconUrl) {
  let link = document.querySelector('link[rel*="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = newIconUrl;
  console.log(`Favicon set for ${websiteUrl}`);
}

// Function to reset favicon
function resetFavicon() {
  const link = document.querySelector('link[rel*="icon"]');
  if (link) {
    link.remove();
    console.log("Favicon reset");
  }
}

// Listen for tab updates (to apply favicons when URL changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    let mappings = await chrome.storage.local.get('faviconMappings');
    mappings = mappings.faviconMappings || {};

    const match = Object.keys(mappings).find(url => tab.url.startsWith(url));
    if (match) {
      const iconData = mappings[match];
      const iconUrl = typeof iconData === 'string' ? iconData : iconData.url;

      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: applyFavicon,
          args: [match, iconUrl],
        });
      } catch (error) {
        console.warn(`Failed to inject favicon into tab ${tabId}:`, error.message);
      }
    } else {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: resetFavicon,
        });
      } catch (error) {
        console.warn(`Reset favicon failed for tab ${tabId}:`, error.message);
      }
    }
  }
});

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "applyFavicon") {
    try {
      // Confirm the tab still exists
      const tab = await chrome.tabs.get(request.tabId);
      if (!tab || !tab.id) throw new Error("Tab not found");

      await chrome.scripting.executeScript({
        target: { tabId: request.tabId },
        func: applyFavicon,
        args: [request.websiteUrl, request.newIconUrl],
      });

      sendResponse({ success: true });
    } catch (err) {
      console.error("Error applying favicon:", err.message);
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep message channel alive
  }

  if (request.action === "removeFavicon") {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.url && tab.url.startsWith(request.websiteUrl)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: resetFavicon,
          });
        } catch (err) {
          console.warn(`Failed to reset favicon in tab ${tab.id}:`, err.message);
        }
      }
    }
    sendResponse({ success: true });
    return true;
  }
});
