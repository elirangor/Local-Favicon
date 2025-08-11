// background.js

// ---- Favicon helpers (unchanged) ----
function applyFavicon(websiteUrl, newIconUrl) {
  console.log('Applying favicon:', websiteUrl, newIconUrl);
  try {
    const existingLinks = document.querySelectorAll('link[rel*="icon"]');
    existingLinks.forEach(link => {
      console.log('Removing existing link:', link.href);
      link.remove();
    });

    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = newIconUrl;
    document.head.appendChild(link);

    const shortcutLink = document.createElement('link');
    shortcutLink.rel = 'shortcut icon';
    shortcutLink.href = newIconUrl;
    document.head.appendChild(shortcutLink);

    console.log('Favicon applied successfully');
    return { success: true };
  } catch (error) {
    console.error('Error applying favicon:', error);
    return { success: false, error: error.message };
  }
}

function resetFavicon() {
  console.log('Resetting favicon');
  try {
    const links = document.querySelectorAll('link[rel*="icon"]');
    links.forEach(link => link.remove());
    console.log('Favicon reset successfully');
    return { success: true };
  } catch (error) {
    console.error('Error resetting favicon:', error);
    return { success: false, error: error.message };
  }
}

// ---- Apply on tab updates (unchanged) ----
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('Tab updated:', tabId, tab.url);

    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      console.log('Skipping restricted URL:', tab.url);
      return;
    }

    try {
      let mappings = await chrome.storage.local.get('faviconMappings');
      mappings = mappings.faviconMappings || {};
      console.log('Current mappings:', mappings);

      const match = Object.keys(mappings).find(url => tab.url.startsWith(url));
      if (match) {
        console.log('Found match:', match);
        const iconData = mappings[match];
        const iconUrl = typeof iconData === 'string' ? iconData : iconData.url;
        console.log('Applying icon:', iconUrl);

        await chrome.scripting.executeScript({
          target: { tabId },
          func: applyFavicon,
          args: [match, iconUrl],
        });
        console.log('Script executed successfully');
      }
    } catch (error) {
      console.error(`Failed to process favicon for tab ${tabId}:`, error);
    }
  }
});

// ---- FIXED onMessage handler ----
// IMPORTANT: do NOT mark listener async. Wrap awaits in an IIFE and return true to keep the port open.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);

  if (request.action === "applyFavicon") {
    (async () => {
      try {
        const tab = await chrome.tabs.get(request.tabId);
        if (!tab || !tab.id) throw new Error("Tab not found");

        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
            tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
          throw new Error("Cannot modify this type of page");
        }

        const result = await chrome.scripting.executeScript({
          target: { tabId: request.tabId },
          func: applyFavicon,
          args: [request.websiteUrl, request.newIconUrl],
        });

        console.log('Script execution result:', result);
        sendResponse({ success: true, result });
      } catch (err) {
        console.error("Error applying favicon:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keep message port open
  }

  if (request.action === "removeFavicon") {
    (async () => {
      try {
        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
          if (!tab.url || !tab.url.startsWith(request.websiteUrl)) continue;

          if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
              tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
            continue;
          }

          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: resetFavicon,
            });
          } catch (err) {
            console.warn(`Failed to reset favicon in tab ${tab.id}:`, err.message);
          }
        }
        sendResponse({ success: true });
      } catch (err) {
        console.error("Error removing favicon:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // keep message port open
  }
});
