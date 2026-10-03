/**
 * AutoFill AI - Utility Functions
 * Helper routines for storage, DOM traversal (shadow DOM + iframes),
 * React/Vue controlled value setting, event dispatching, and fuzzy matching.
 */

export const STORAGE_KEYS = {
  API_KEY: 'autofill_api_key',
  PROVIDER: 'autofill_provider',
  GEMINI_MODEL: 'autofill_gemini_model',
  OPENAI_MODEL: 'autofill_openai_model',
  ANTHROPIC_MODEL: 'autofill_anthropic_model',
  PROFILE_MD: 'autofill_profile_md',
  LEARNED_ANSWERS: 'autofill_learned_answers',
  RESUME_FILE: 'autofill_resume_file', // Backward-compatible primary resume { name, type, base64, size }
  STORED_FILES: 'autofill_stored_files', // Array of { id, name, type, size, base64, label, isDefault, updatedAt }
  AUTO_ATTACH_RESUME: 'autofill_auto_attach_resume', // boolean (default true)
  SETTINGS: 'autofill_settings',
};

/**
 * Promise-wrapped chrome.storage.local getter
 */
export async function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result || {});
    });
  });
}

/**
 * Promise-wrapped chrome.storage.local setter
 */
export async function setStorageData(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => {
      resolve(true);
    });
  });
}

/**
 * Safely set a value on a modern framework input (React, Vue, Angular, Svelte).
 * Modern frameworks override the `value` setter on the element instance to track state.
 * By invoking the prototype's original descriptor setter, we bypass framework overrides
 * and then trigger bubbling events so the framework's internal listener catches the change!
 */
export function setControlledInputValue(element, value) {
  if (!element) return false;

  const tag = element.tagName.toLowerCase();
  let proto;

  if (tag === 'input') {
    proto = window.HTMLInputElement.prototype;
  } else if (tag === 'textarea') {
    proto = window.HTMLTextAreaElement.prototype;
  } else if (tag === 'select') {
    proto = window.HTMLSelectElement.prototype;
  }

  try {
    if (proto) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    } else if (element.isContentEditable) {
      element.innerText = value;
    } else {
      element.value = value;
    }
  } catch (err) {
    element.value = value;
  }

  // Dispatch bubbling events so frameworks update state immediately
  dispatchInputEvents(element);
  return true;
}

/**
 * Dispatch bubbling synthetic events simulating real user interaction
 */
export function dispatchInputEvents(element) {
  if (!element) return;

  const eventOpts = { bubbles: true, cancelable: true };

  // 1. Focus
  try { element.focus(); } catch (_) {}

  // 2. Input event (React 16+ listens to this)
  element.dispatchEvent(new Event('input', eventOpts));

  // 3. Change event (Native forms, Vue, and Angular listen to this)
  element.dispatchEvent(new Event('change', eventOpts));

  // 4. Blur event (Triggers validation & touched state)
  element.dispatchEvent(new Event('blur', eventOpts));
}

/**
 * Fuzzy match a target string with available select or radio options.
 * Matches case-insensitively, trimmed, and checks substring/token similarity.
 */
export function matchOptionValue(options, targetVal) {
  if (!options || !Array.isArray(options) || options.length === 0 || targetVal === null || targetVal === undefined) {
    return null;
  }

  const cleanTarget = String(targetVal).trim().toLowerCase();
  if (!cleanTarget) return null;

  // 1. Exact match by value or text
  for (const opt of options) {
    const optVal = String(opt.value || '').trim().toLowerCase();
    const optText = String(opt.text || opt.label || '').trim().toLowerCase();
    if (optVal === cleanTarget || optText === cleanTarget) {
      return opt;
    }
  }

  // 2. Normalized alphanumeric match
  const normTarget = cleanTarget.replace(/[^a-z0-9]/g, '');
  for (const opt of options) {
    const optVal = String(opt.value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const optText = String(opt.text || opt.label || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normTarget && (optVal === normTarget || optText === normTarget)) {
      return opt;
    }
  }

  // 3. Boolean/Yes-No aliases
  if (['yes', 'true', '1', 'authorized', 'y', 'require sponsorship', 'will relocate'].includes(cleanTarget)) {
    for (const opt of options) {
      const text = String(opt.text || opt.value || '').toLowerCase();
      if (/^(yes|true|authorized|agree|accept)$/i.test(text.trim())) return opt;
    }
  }
  if (['no', 'false', '0', 'unauthorized', 'n', 'no sponsorship', 'will not relocate'].includes(cleanTarget)) {
    for (const opt of options) {
      const text = String(opt.text || opt.value || '').toLowerCase();
      if (/^(no|false|decline|do not|disagree)$/i.test(text.trim())) return opt;
    }
  }

  // 4. Common abbreviations (US/USA, UK, Gender, States)
  const ABBREVS = [
    ['us', 'usa', 'united states', 'united states of america'],
    ['uk', 'united kingdom', 'great britain', 'gb'],
    ['ca', 'canada'], ['in', 'india'], ['au', 'australia'],
    ['m', 'male', 'man'], ['f', 'female', 'woman'],
    ['ft', 'full-time', 'full time'], ['pt', 'part-time', 'part time'],
    ['ca', 'california'], ['ny', 'new york'], ['tx', 'texas'], ['fl', 'florida'], ['wa', 'washington']
  ];
  for (const group of ABBREVS) {
    if (group.includes(cleanTarget) || group.includes(normTarget)) {
      for (const opt of options) {
        const oVal = String(opt.value || '').trim().toLowerCase();
        const oTxt = String(opt.text || opt.label || '').trim().toLowerCase();
        const oNorm = oTxt.replace(/[^a-z0-9]/g, '');
        if (group.includes(oVal) || group.includes(oTxt) || group.includes(oNorm)) {
          return opt;
        }
      }
    }
  }

  // 5. Substring inclusion
  for (const opt of options) {
    const optText = String(opt.text || opt.label || '').trim().toLowerCase();
    if (optText.length > 2 && (optText.includes(cleanTarget) || cleanTarget.includes(optText))) {
      return opt;
    }
  }

  return null;
}

/**
 * Traverse DOM recursively including Open Shadow DOM roots.
 */
export function getAllElementsDeep(rootNode = document, selector = '*') {
  const elements = [];

  function walk(node) {
    if (!node) return;

    // Check if node itself matches or has children
    if (node.querySelectorAll) {
      const matched = node.querySelectorAll(selector);
      for (let i = 0; i < matched.length; i++) {
        elements.push(matched[i]);
      }
    }

    // Traverse shadow roots of all descendants
    const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    let curr = treeWalker.currentNode;
    while (curr) {
      if (curr.shadowRoot) {
        walk(curr.shadowRoot);
      }
      curr = treeWalker.nextNode();
    }
  }

  walk(rootNode);
  return elements;
}

/**
 * Convert base64 data to File object and attach to a file input using DataTransfer
 */
export function attachBase64FileToInput(inputElement, base64Data, fileName = 'resume.pdf', mimeType = 'application/pdf') {
  try {
    const byteCharacters = atob(base64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType, lastModified: Date.now() });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputElement.files = dataTransfer.files;

    dispatchInputEvents(inputElement);
    return true;
  } catch (err) {
    console.warn('[AutoFill AI] Failed to attach file to input:', err);
    return false;
  }
}
