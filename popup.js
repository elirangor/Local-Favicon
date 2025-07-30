document.addEventListener('DOMContentLoaded', async () => {
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

  /**
   * Fetches the active tab's URL and pre-fills the input.
   */
  const getActiveTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    if (tab?.url) {
      try {
        // Use URL.origin to get the base URL (e.g., https://example.com)
        urlInput.value = new URL(tab.url).origin;
      } catch (e) {
        console.warn("Could not parse tab URL origin:", e);
        urlInput.value = ''; // Clear if URL is invalid
      }
    }
  };

  /**
   * Converts a File object to a Data URL (base64 string).
   * @param {File} file - The file to convert.
   * @returns {Promise<string>} A promise that resolves with the Data URL.
   */
  const fileToDataURL = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject("Failed to read file.");
    reader.readAsDataURL(file);
  });

  /**
   * Displays a temporary message to the user.
   * @param {string} msg - The message text.
   * @param {'success'|'error'} type - The type of message (for styling).
   */
  const showMessage = (msg, type) => {
    messageDiv.textContent = msg;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
      messageDiv.textContent = '';
      messageDiv.className = 'message'; // Reset class
    }, 3000);
  };

  // --- Dark Mode Logic ---

  /**
   * Applies or removes the 'dark-mode' class to the body.
   * @param {boolean} enable - True to enable dark mode, false to disable.
   */
  const applyDarkMode = (enable) => {
    if (enable) {
      body.classList.add('dark-mode');
      darkModeToggle.querySelector('i').className = 'fas fa-sun'; // Change icon to sun
      darkModeToggle.title = 'Toggle Light Mode';
    } else {
      body.classList.remove('dark-mode');
      darkModeToggle.querySelector('i').className = 'fas fa-moon'; // Change icon to moon
      darkModeToggle.title = 'Toggle Night Mode';
    }
  };

  /**
   * Loads dark mode preference from storage and applies it.
   */
  const loadDarkModePreference = async () => {
    const { darkModeEnabled } = await chrome.storage.local.get('darkModeEnabled');
    applyDarkMode(darkModeEnabled);
  };

  // --- Favicon List Rendering ---

  /**
   * Renders the list of currently set custom favicons.
   */
  const renderFaviconList = async () => {
    const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
    faviconList.innerHTML = ''; // Clear existing list items
    const keys = Object.keys(faviconMappings);

    if (keys.length === 0) {
      noFaviconsMessage.style.display = 'block';
      faviconList.appendChild(noFaviconsMessage);
      return;
    }

    noFaviconsMessage.style.display = 'none'; // Hide "No favicons" message

    keys.forEach(websiteUrl => {
      const entry = faviconMappings[websiteUrl];
      // Determine the actual icon URL and a display label
      const iconUrl = typeof entry === 'string' ? entry : entry.url;
      const label = typeof entry === 'string' ? iconUrl : entry.name || '(uploaded image)';

      const li = document.createElement('li');
      li.innerHTML = `
        <div class="favicon-entry-info">
          <a class="site-link" href="${websiteUrl}" target="_blank">${websiteUrl}</a>
          <a class="favicon-link" href="${iconUrl}" target="_blank">${label}</a>
        </div>
        <div class="favicon-actions">
          <button class="copy-button" data-copy="${iconUrl}">Copy</button>
          <button class="delete-button" data-url="${websiteUrl}">Delete</button>
        </div>
      `;
      faviconList.appendChild(li);
    });

    // Attach event listeners to newly created buttons
    document.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', () => {
        // Use document.execCommand for clipboard operations in extensions
        const textarea = document.createElement('textarea');
        textarea.value = button.dataset.copy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showMessage('Copied to clipboard', 'success');
      });
    });

    document.querySelectorAll('.delete-button').forEach(button => {
      button.addEventListener('click', async () => {
        const urlToDelete = button.dataset.url;
        const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
        delete faviconMappings[urlToDelete]; // Remove the mapping
        await chrome.storage.local.set({ faviconMappings }); // Save updated mappings

        // Inform background script to remove favicon from relevant tabs
        chrome.runtime.sendMessage({
          action: 'removeFavicon',
          websiteUrl: urlToDelete // Send the URL to remove
        });

        renderFaviconList(); // Re-render the list
        showMessage('Favicon removed', 'success');
      });
    });
  };

  // --- Event Listeners ---

  // Handle favicon source radio button changes
  sourceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const useUpload = radio.value === 'upload';
      iconUrlInput.disabled = useUpload; // Disable URL input if uploading
      uploadSection.style.display = useUpload ? 'block' : 'none'; // Show/hide upload section

      // Clear the other input when switching modes
      if (useUpload) {
        iconUrlInput.value = '';
      } else {
        fileInput.value = '';
        fileNameDisplay.textContent = '';
      }
    });
  });

  // Display selected file name
  fileInput.addEventListener('change', () => {
    fileNameDisplay.textContent = fileInput.files[0]?.name || '';
  });

  // Handle "Set Favicon" button click
  setFaviconButton.addEventListener('click', async () => {
    const websiteUrl = urlInput.value.trim();
    const isUpload = [...sourceRadios].find(r => r.checked)?.value === 'upload';

    if (!websiteUrl) {
      return showMessage("Website URL is required.", "error");
    }

    let newIconUrl = '';
    let fileName = '';

    if (isUpload) {
      const file = fileInput.files[0];
      if (!file) {
        return showMessage("Please choose an image file.", "error");
      }
      try {
        newIconUrl = await fileToDataURL(file);
        fileName = file.name;
      } catch (e) {
        console.error("Error reading file:", e);
        return showMessage("Error reading file.", "error");
      }
    } else {
      newIconUrl = iconUrlInput.value.trim();
      if (!newIconUrl) {
        return showMessage("Favicon URL is required.", "error");
      }
      try {
        new URL(newIconUrl); // Validate URL format
      } catch (e) {
        console.error("Invalid favicon URL:", e);
        return showMessage("Invalid favicon URL. Please use a full URL (e.g., https://example.com/icon.png).", "error");
      }
    }

    try {
      const { faviconMappings = {} } = await chrome.storage.local.get('faviconMappings');
      // Store the mapping. For uploaded images, store an object with url and name.
      faviconMappings[websiteUrl] = isUpload ? { url: newIconUrl, name: fileName } : newIconUrl;
      await chrome.storage.local.set({ faviconMappings });

      // If there's an active tab, immediately apply the favicon to it
      if (currentTab?.id) {
        chrome.runtime.sendMessage({
          action: 'applyFavicon',
          tabId: currentTab.id,
          websiteUrl, // Send the website URL for matching
          newIconUrl // Send the new icon URL
        });
      }

      showMessage("Favicon set successfully!", "success");
      // Clear inputs after successful set
      iconUrlInput.value = '';
      fileInput.value = '';
      fileNameDisplay.textContent = '';
      renderFaviconList(); // Re-render the list to show the new entry
    } catch (err) {
      console.error("Error saving favicon:", err);
      showMessage("Error saving favicon.", "error");
    }
  });

  // Handle dark mode toggle button click
  darkModeToggle.addEventListener('click', async () => {
    const { darkModeEnabled } = await chrome.storage.local.get('darkModeEnabled');
    const newDarkModeState = !darkModeEnabled;
    await chrome.storage.local.set({ darkModeEnabled: newDarkModeState });
    applyDarkMode(newDarkModeState);
  });

  // --- Initial Setup ---
  await getActiveTab(); // Get current tab info on popup open
  await loadDarkModePreference(); // Load and apply dark mode preference
  renderFaviconList(); // Populate the list of custom favicons
});
