/**
 * AutoFill AI - Popup Script
 */

import { getStorageData, setStorageData, STORAGE_KEYS } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statusProvider = document.getElementById('status-provider');
  const statusResume = document.getElementById('status-resume');
  const btnFill = document.getElementById('btn-fill-page');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const btnOpenOptionsIcon = document.getElementById('btn-open-options-icon');
  const btnOpenSetup = document.getElementById('btn-open-setup');
  const setupAlert = document.getElementById('setup-alert');
  const popupFileInput = document.getElementById('popup-file-input');
  const quickUploadStatus = document.getElementById('quick-upload-status');

  // Load state
  await refreshStatus();

  // Button Listeners
  btnFill.addEventListener('click', async () => {
    btnFill.disabled = true;
    btnFill.innerHTML = '<span>⏳ Scanning & Filling...</span>';

    try {
      const response = await chrome.runtime.sendMessage({ action: 'TRIGGER_AUTOFILL_FROM_POPUP' });
      if (response && response.success) {
        btnFill.innerHTML = '<span>✅ Filled Successfully!</span>';
        setTimeout(() => window.close(), 1200);
      } else {
        alert(response?.error || 'Failed to trigger autofill. Ensure you are on a webpage with form fields.');
        btnFill.disabled = false;
        btnFill.innerHTML = '<span>⚡ Fill This Page</span>';
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
      btnFill.disabled = false;
      btnFill.innerHTML = '<span>⚡ Fill This Page</span>';
    }
  });

  const openOptionsPage = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  };

  btnOpenOptions.addEventListener('click', openOptionsPage);
  btnOpenOptionsIcon.addEventListener('click', openOptionsPage);
  btnOpenSetup.addEventListener('click', openOptionsPage);

  // Quick PDF file upload handler
  popupFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      quickUploadStatus.textContent = '❌ PDF exceeds 20 MB limit';
      return;
    }

    quickUploadStatus.textContent = 'Reading PDF...';
    try {
      const arrayBuffer = await file.arrayBuffer();

      // Convert to base64 for resume auto-attachment
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      await setStorageData({
        [STORAGE_KEYS.RESUME_FILE]: {
          name: file.name,
          type: file.type || 'application/pdf',
          base64,
          updatedAt: new Date().toISOString(),
        },
      });

      quickUploadStatus.textContent = 'Extracting & merging with LLM...';

      const storage = await getStorageData([STORAGE_KEYS.PROFILE_MD, STORAGE_KEYS.API_KEY]);
      if (!storage[STORAGE_KEYS.API_KEY]) {
        quickUploadStatus.textContent = '❌ Set API Key in Settings first';
        return;
      }

      const existing = storage[STORAGE_KEYS.PROFILE_MD] || '';

      const resp = await chrome.runtime.sendMessage({
        action: 'ACTION_EXTRACT_AND_MERGE_PDF',
        files: [{ name: file.name, type: file.type || 'application/pdf', base64 }],
        existingProfile: existing,
      });

      if (resp && resp.success) {
        quickUploadStatus.textContent = '✅ Profile extracted & merged!';
        await refreshStatus();
      } else {
        quickUploadStatus.textContent = `❌ ${resp?.error || 'Failed'}`;
      }
    } catch (err) {
      quickUploadStatus.textContent = `❌ ${err.message}`;
    }
  });

  async function refreshStatus() {
    const data = await getStorageData([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.PROFILE_MD,
      STORAGE_KEYS.PROVIDER,
      STORAGE_KEYS.RESUME_FILE,
    ]);

    const hasApiKey = Boolean(data[STORAGE_KEYS.API_KEY]);
    const hasProfile = Boolean(data[STORAGE_KEYS.PROFILE_MD]?.trim());
    const resumeObj = data[STORAGE_KEYS.RESUME_FILE];

    const providerNames = {
      gemini: 'Google Gemini',
      openai: 'OpenAI',
      anthropic: 'Anthropic Claude',
    };

    statusProvider.textContent = providerNames[data[STORAGE_KEYS.PROVIDER]] || 'Gemini (Default)';
    statusResume.textContent = resumeObj ? resumeObj.name : 'None (Optional)';

    if (hasApiKey && hasProfile) {
      statusDot.className = 'dot dot-green';
      statusText.textContent = 'Ready to autofill';
      btnFill.disabled = false;
      setupAlert.classList.add('hidden');
    } else {
      statusDot.className = 'dot dot-yellow';
      btnFill.disabled = true;
      setupAlert.classList.remove('hidden');

      if (!hasApiKey && !hasProfile) {
        statusText.textContent = 'Setup required';
      } else if (!hasApiKey) {
        statusText.textContent = 'Missing API Key';
      } else {
        statusText.textContent = 'Profile empty';
      }
    }
  }
});
