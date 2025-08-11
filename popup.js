document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');
  
  const urlInput = document.getElementById('urlInput');
  const iconUrlInput = document.getElementById('iconUrlInput');
  const fileInput = document.getElementById('fileInput');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const sourceRadios = document.getElementsByName('source');
  const uploadSection = document.getElementById('uploadSection');
  const setFaviconButton = document.getElementById('setFaviconButton');
  const messageDiv = document.getElementById('message');
  const faviconList = document.getElementById('faviconList');
  const noFaviconsMessage = document.getElementById('noFaviconsMessage');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const body = document.body;

  let currentTab = null;

  // --- Utility Functions ---
  const getActiveTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tab;
      console.log('Current tab:', tab);
      
      if (tab?.url) {
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || 
            tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
          urlInput.value = '';
          showMessage("This type of page cannot be modified by extensions.", "error");
          return;
        }
        
        try {
          urlInput.value = new URL(tab.url).origin;
        } catch (e) {
          console.warn("Could not parse tab URL origin:", e);
          urlInput.value = '';
        }
      }
    } catch (error) {
      console.error("Error getting active tab:", error);
    }
  };

  const fileToDataURL = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject("Failed to read file.");
    reader.readAsDataURL(file);
  });

  const showMessage = (msg, type) => {
    messageDiv.textContent = msg;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
      messageDiv.textContent = '';
      messageDiv.className = 'message';
    }, 4000);
  };

  const applyDarkMode = (enable) => {
    if (enable) {
      body.classList.add('dark-mode');
      darkModeToggle.querySelector('i').className = 'fas fa-sun';
      darkModeToggle.title = 'Toggle Light Mode';
    } else {
      body.classList.remove('dark-mode');
      darkModeToggle.querySelector('i').className = 'fas fa-moon';
      darkModeToggle.title = 'Toggle Night Mode';
    }
  };

  const loadDarkModePreference = async () => {
    const { darkModeEnabled } = await chrome.storage.local.get('darkModeEnabled');
    applyDarkMode(darkModeEnabled);
  };

  const renderFaviconList = async () => {
    const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
    faviconList.innerHTML = '';
    const keys = Object.keys(faviconMappings);

    if (keys.length === 0) {
      noFaviconsMessage.style.display = 'block';
      faviconList.appendChild(noFaviconsMessage);
      return;
    }

    noFaviconsMessage.style.display = 'none';

    keys.forEach(websiteUrl => {
      const entry = faviconMappings[websiteUrl];
      const iconUrl = typeof entry === 'string' ? entry : entry.url;
      const label = typeof entry === 'string' ? 
        (iconUrl.startsWith('data:') ? '(uploaded image)' : iconUrl) : 
        (entry.name || '(uploaded image)');

      const li = document.createElement('li');
      li.innerHTML = `
        <div class="favicon-entry-info">
          <a class="site-link" href="${websiteUrl}" target="_blank">${websiteUrl}</a>
          <span class="favicon-link">${label}</span>
        </div>
        <div class="favicon-actions">
          <button class="copy-button" data-copy="${iconUrl}">Copy</button>
          <button class="delete-button" data-url="${websiteUrl}">Delete</button>
        </div>
      `;
      faviconList.appendChild(li);
    });

    document.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          showMessage('Copied to clipboard', 'success');
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = button.dataset.copy;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          showMessage('Copied to clipboard', 'success');
        }
      });
    });

    document.querySelectorAll('.delete-button').forEach(button => {
      button.addEventListener('click', async () => {
        const urlToDelete = button.dataset.url;
        const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
        delete faviconMappings[urlToDelete];
        await chrome.storage.local.set({ faviconMappings });

        chrome.runtime.sendMessage({
          action: 'removeFavicon',
          websiteUrl: urlToDelete
        });

        renderFaviconList();
        showMessage('Favicon removed', 'success');
      });
    });
  };

  sourceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const useUpload = radio.value === 'upload';
      iconUrlInput.disabled = useUpload;
      uploadSection.style.display = useUpload ? 'block' : 'none';
      if (useUpload) {
        iconUrlInput.value = '';
      } else {
        fileInput.value = '';
        fileNameDisplay.textContent = '';
      }
    });
  });

  fileInput.addEventListener('change', () => {
    const fileName = fileInput.files[0]?.name || '';
    fileNameDisplay.textContent = fileName;
  });

  const urlToDataURL = async (url) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          resolve(url);
        }
      };
      img.onerror = () => resolve(url);
      setTimeout(() => resolve(url), 10000);
      img.src = url;
    });
  };

  // helper to send messages safely
  const sendMessagePromise = (msg) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res);
        }
      });
    });

  setFaviconButton.addEventListener('click', async () => {
    const websiteUrl = urlInput.value.trim();
    const isUpload = [...sourceRadios].find(r => r.checked)?.value === 'upload';

    if (!websiteUrl) {
      showMessage("Website URL is required.", "error");
      return;
    }

    if (websiteUrl.startsWith('chrome://') || websiteUrl.startsWith('chrome-extension://') || 
        websiteUrl.startsWith('edge://') || websiteUrl.startsWith('about:')) {
      showMessage("This URL type cannot be modified by extensions.", "error");
      return;
    }

    let newIconUrl = '';
    let fileName = '';

    setFaviconButton.disabled = true;
    setFaviconButton.textContent = 'Processing...';

    try {
      if (isUpload) {
        const file = fileInput.files[0];
        if (!file) {
          showMessage("Please choose an image file.", "error");
          return;
        }
        if (file.size > 2 * 1024 * 1024) {
          showMessage("File size too large. Please choose a file under 2MB.", "error");
          return;
        }
        newIconUrl = await fileToDataURL(file);
        fileName = file.name;
      } else {
        const originalUrl = iconUrlInput.value.trim();
        if (!originalUrl) {
          showMessage("Favicon URL is required.", "error");
          return;
        }
        try {
          new URL(originalUrl);
        } catch {
          showMessage("Invalid URL format.", "error");
          return;
        }
        newIconUrl = await urlToDataURL(originalUrl);
      }

      const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
      faviconMappings[websiteUrl] = isUpload ? { url: newIconUrl, name: fileName } : newIconUrl;
      await chrome.storage.local.set({ faviconMappings });

      if (currentTab?.id && currentTab.url?.startsWith(websiteUrl)) {
        const response = await sendMessagePromise({
          action: 'applyFavicon',
          tabId: currentTab.id,
          websiteUrl,
          newIconUrl
        });

        if (!response?.success) {
          showMessage("Favicon saved but could not be applied immediately: " + (response?.error || "Unknown error"), "error");
        } else {
          showMessage("Favicon set successfully!", "success");
        }
      } else {
        showMessage("Favicon saved! It will be applied when you visit the website.", "success");
      }

      iconUrlInput.value = '';
      fileInput.value = '';
      fileNameDisplay.textContent = '';
      renderFaviconList();
    } catch (err) {
      showMessage("Error: " + err.message, "error");
    } finally {
      setFaviconButton.disabled = false;
      setFaviconButton.textContent = 'Set Favicon';
    }
  });

  darkModeToggle.addEventListener('click', async () => {
    const { darkModeEnabled } = await chrome.storage.local.get('darkModeEnabled');
    const newDarkModeState = !darkModeEnabled;
    await chrome.storage.local.set({ darkModeEnabled: newDarkModeState });
    applyDarkMode(newDarkModeState);
  });

  await getActiveTab();
  await loadDarkModePreference();
  await renderFaviconList();
});
