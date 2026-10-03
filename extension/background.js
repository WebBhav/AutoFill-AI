/**
 * AutoFill AI - Background Service Worker (Manifest V3)
 * Manages context menus, keyboard shortcuts, secure storage, and CORS-free LLM API calls.
 */

import {
  generateProfileFromText,
  extractAndMergeProfileFromPDF,
  matchFieldsWithProfile,
  planRepeatableSections,
} from './llm.js';
import { getStorageData, setStorageData, STORAGE_KEYS } from './utils.js';

// Setup Context Menus and Lifecycle Events
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoFill AI] Background service worker installed.');

  // Create right-click context menu
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'autofill_page_menu',
      title: 'AutoFill AI: Fill forms on this page',
      contexts: ['page', 'editable'],
    });
  });
});

// Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'autofill_page_menu' && tab?.id) {
    triggerAutofillInTab(tab.id);
  }
});

// Handle Keyboard Shortcuts (e.g., Alt+Shift+F)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'fill-page') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      triggerAutofillInTab(activeTab.id);
    }
  }
});

/**
 * Send trigger message to content script in the given tab.
 * If content script has not loaded yet (e.g. fresh navigation), inject it dynamically.
 */
async function triggerAutofillInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AUTOFILL' });
  } catch (err) {
    console.warn('[AutoFill AI] Content script not responding, attempting injection...', err);
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css'],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AUTOFILL' });
    } catch (injectErr) {
      console.error('[AutoFill AI] Failed to inject content script:', injectErr);
    }
  }
}

/**
 * Message Dispatcher for Popup, Options, and Content Scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  switch (action) {
    case 'TRIGGER_AUTOFILL_FROM_POPUP': {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id) {
            sendResponse({ success: false, error: 'No active tab found.' });
            return;
          }
          await triggerAutofillInTab(activeTab.id);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_GENERATE_PROFILE': {
      (async () => {
        try {
          const { text, existingProfile } = request;
          const storage = await getStorageData([
            STORAGE_KEYS.API_KEY,
            STORAGE_KEYS.PROVIDER,
            STORAGE_KEYS.GEMINI_MODEL,
            STORAGE_KEYS.OPENAI_MODEL,
            STORAGE_KEYS.ANTHROPIC_MODEL,
          ]);

          const apiKey = storage[STORAGE_KEYS.API_KEY];
          const provider = storage[STORAGE_KEYS.PROVIDER] || 'gemini';
          const model =
            provider === 'gemini'
              ? storage[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-3.8-flash'
              : provider === 'openai'
              ? storage[STORAGE_KEYS.OPENAI_MODEL] || 'gpt-4o-mini'
              : storage[STORAGE_KEYS.ANTHROPIC_MODEL] || 'claude-3-5-sonnet-20241022';

          if (!apiKey) {
            sendResponse({
              success: false,
              error: 'Please configure your LLM API Key in AutoFill AI Settings first.',
            });
            return;
          }

          const profileMd = await generateProfileFromText({
            text,
            existingProfile,
            apiKey,
            provider,
            model,
          });

          await setStorageData({ [STORAGE_KEYS.PROFILE_MD]: profileMd });
          sendResponse({ success: true, profileMd });
        } catch (err) {
          console.error('[AutoFill AI] Profile generation error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_EXTRACT_AND_MERGE_PDF': {
      (async () => {
        try {
          const { files, existingProfile } = request;
          const storage = await getStorageData([
            STORAGE_KEYS.API_KEY,
            STORAGE_KEYS.PROVIDER,
            STORAGE_KEYS.GEMINI_MODEL,
            STORAGE_KEYS.OPENAI_MODEL,
            STORAGE_KEYS.ANTHROPIC_MODEL,
          ]);

          const apiKey = storage[STORAGE_KEYS.API_KEY];
          const provider = storage[STORAGE_KEYS.PROVIDER] || 'gemini';
          const model =
            provider === 'gemini'
              ? storage[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-3.8-flash'
              : provider === 'openai'
              ? storage[STORAGE_KEYS.OPENAI_MODEL] || 'gpt-4o-mini'
              : storage[STORAGE_KEYS.ANTHROPIC_MODEL] || 'claude-3-5-sonnet-20241022';

          if (!apiKey) {
            sendResponse({
              success: false,
              error: 'Please configure your LLM API Key in AutoFill AI Settings first.',
            });
            return;
          }

          // Check file sizes (20MB limit)
          const MAX_SIZE = 20 * 1024 * 1024;
          const fileList = Array.isArray(files) ? files : [files];
          for (const f of fileList) {
            if (f && f.size && f.size > MAX_SIZE) {
              sendResponse({
                success: false,
                error: `File "${f.name || 'PDF'}" exceeds the 20 MB limit. Please use a smaller or compressed document.`,
              });
              return;
            }
          }

          const profileMd = await extractAndMergeProfileFromPDF({
            files,
            existingProfile,
            apiKey,
            provider,
            model,
          });

          await setStorageData({ [STORAGE_KEYS.PROFILE_MD]: profileMd });
          sendResponse({ success: true, profileMd });
        } catch (err) {
          console.error('[AutoFill AI] PDF extraction & merge error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_MATCH_FIELDS': {
      (async () => {
        try {
          const { fields, pageContext } = request;
          const storage = await getStorageData([
            STORAGE_KEYS.API_KEY,
            STORAGE_KEYS.PROVIDER,
            STORAGE_KEYS.GEMINI_MODEL,
            STORAGE_KEYS.OPENAI_MODEL,
            STORAGE_KEYS.ANTHROPIC_MODEL,
            STORAGE_KEYS.PROFILE_MD,
            STORAGE_KEYS.LEARNED_ANSWERS,
          ]);

          const apiKey = storage[STORAGE_KEYS.API_KEY];
          const provider = storage[STORAGE_KEYS.PROVIDER] || 'gemini';
          const profile = storage[STORAGE_KEYS.PROFILE_MD];
          const learnedAnswers = storage[STORAGE_KEYS.LEARNED_ANSWERS] || {};

          if (!profile || profile.trim().length === 0) {
            sendResponse({
              success: false,
              error: 'Your AutoFill profile is empty. Click the extension icon and configure your profile from your resume.',
            });
            return;
          }

          if (!apiKey) {
            sendResponse({
              success: false,
              error: 'Missing LLM API Key. Please open extension settings and save your key.',
            });
            return;
          }

          const model =
            provider === 'gemini'
              ? storage[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-3.8-flash'
              : provider === 'openai'
              ? storage[STORAGE_KEYS.OPENAI_MODEL] || 'gpt-4o-mini'
              : storage[STORAGE_KEYS.ANTHROPIC_MODEL] || 'claude-3-5-sonnet-20241022';

          const results = await matchFieldsWithProfile({
            fields,
            profile,
            learnedAnswers,
            pageContext,
            apiKey,
            provider,
            model,
          });

          sendResponse({ success: true, results });
        } catch (err) {
          console.error('[AutoFill AI] Match fields error:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_PLAN_REPEATABLE_SECTIONS': {
      (async () => {
        try {
          const { sections } = request;
          const storage = await getStorageData([
            STORAGE_KEYS.API_KEY,
            STORAGE_KEYS.PROVIDER,
            STORAGE_KEYS.GEMINI_MODEL,
            STORAGE_KEYS.OPENAI_MODEL,
            STORAGE_KEYS.ANTHROPIC_MODEL,
            STORAGE_KEYS.PROFILE_MD,
          ]);

          const apiKey = storage[STORAGE_KEYS.API_KEY];
          const provider = storage[STORAGE_KEYS.PROVIDER] || 'gemini';
          const profile = storage[STORAGE_KEYS.PROFILE_MD];

          if (!profile || profile.trim().length === 0 || !apiKey) {
            sendResponse({ success: false, plans: [], error: 'API key or profile missing.' });
            return;
          }

          const model =
            provider === 'gemini'
              ? storage[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-3.8-flash'
              : provider === 'openai'
              ? storage[STORAGE_KEYS.OPENAI_MODEL] || 'gpt-4o-mini'
              : storage[STORAGE_KEYS.ANTHROPIC_MODEL] || 'claude-3-5-sonnet-20241022';

          const plans = await planRepeatableSections({
            sections,
            profile,
            apiKey,
            provider,
            model,
          });

          sendResponse({ success: true, plans });
        } catch (err) {
          console.error('[AutoFill AI] Repeatable sections planning error:', err);
          sendResponse({ success: false, plans: [], error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_SAVE_LEARNED_ANSWER': {
      (async () => {
        try {
          const { questionKey, answer, reason } = request;
          if (!questionKey) {
            sendResponse({ success: false, error: 'Invalid question key.' });
            return;
          }

          const storage = await getStorageData([STORAGE_KEYS.LEARNED_ANSWERS]);
          const learned = storage[STORAGE_KEYS.LEARNED_ANSWERS] || {};

          learned[questionKey] = {
            answer,
            reason: reason || 'User corrected in Review panel',
            updatedAt: new Date().toISOString(),
          };

          await setStorageData({ [STORAGE_KEYS.LEARNED_ANSWERS]: learned });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_GET_STATUS': {
      (async () => {
        try {
          const storage = await getStorageData([
            STORAGE_KEYS.API_KEY,
            STORAGE_KEYS.PROVIDER,
            STORAGE_KEYS.PROFILE_MD,
            STORAGE_KEYS.RESUME_FILE,
            STORAGE_KEYS.STORED_FILES,
            STORAGE_KEYS.AUTO_ATTACH_RESUME,
          ]);

          const storedFiles = storage[STORAGE_KEYS.STORED_FILES] || [];
          const hasResume = Boolean(storage[STORAGE_KEYS.RESUME_FILE] || storedFiles.length > 0);
          const autoAttachResume = storage[STORAGE_KEYS.AUTO_ATTACH_RESUME] !== false;

          sendResponse({
            success: true,
            hasApiKey: Boolean(storage[STORAGE_KEYS.API_KEY]),
            hasProfile: Boolean(storage[STORAGE_KEYS.PROFILE_MD]?.trim()),
            hasResume,
            storedFilesCount: storedFiles.length,
            autoAttachResume,
            provider: storage[STORAGE_KEYS.PROVIDER] || 'gemini',
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'ACTION_CLEAR_ALL_DATA': {
      chrome.storage.local.clear(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    default:
      console.warn('[AutoFill AI] Unknown message action:', action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});
