/**
 * AutoFill AI - Content Script (Enhanced)
 * Scans page DOM (including Shadow DOM, custom ARIA comboboxes, dropzones & portals),
 * groups radios & multi-select checkboxes, matches native & custom dropdowns reliably,
 * handles resume & document auto-attachment with DataTransfer and DragEvents,
 * logs with console.debug, and reports status & manual actions in the Review panel.
 */

(() => {
  // Prevent duplicate injection in the same execution context
  if (window.__AUTOFILL_AI_LOADED__) return;
  window.__AUTOFILL_AI_LOADED__ = true;

  console.debug('[AutoFill AI] Content script active with resume auto-attachment and enhanced form-filling engine.');

  // Session state for current page
  let activeFieldMap = new Map(); // id -> fieldRecord
  let undoHistory = []; // Stack of snapshots for Undo
  let floatingBadgeEl = null;
  let reviewModalEl = null;
  let cachedStoredFiles = [];
  let cachedFallbackResume = null;
  let cachedAutoAttachSetting = true;
  let activeRepeatableFailures = []; // Failures to reveal repeatable rows

  // Listen for trigger messages from background (popup, context menu, or keyboard shortcut)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TRIGGER_AUTOFILL') {
      executeAutofillProcess()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    }
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Main Autofill Pipeline
   */
  async function executeAutofillProcess() {
    showToast('AutoFill AI: Scanning form fields & repeatable sections...', 'info');

    // 1. Fetch storage data (Learned answers, stored documents, settings)
    const storage = await new Promise(resolve => {
      chrome.storage.local.get([
        'autofill_learned_answers',
        'autofill_resume_file',
        'autofill_stored_files',
        'autofill_auto_attach_resume',
      ], resolve);
    });

    const learnedAnswers = storage?.autofill_learned_answers || {};
    cachedFallbackResume = storage?.autofill_resume_file || null;
    cachedStoredFiles = storage?.autofill_stored_files || [];
    cachedAutoAttachSetting = storage?.autofill_auto_attach_resume !== false;
    activeRepeatableFailures = [];

    // 2. Detect & Plan Repeatable Sections (e.g. "+ Add website", "+ Add experience", "+ Add skill")
    const repeatableSections = detectRepeatableSections(document);
    if (repeatableSections.length > 0) {
      console.debug(`[AutoFill AI] Detected ${repeatableSections.length} repeatable section(s):`, repeatableSections);
      showToast(`AutoFill AI: Planning ${repeatableSections.length} repeatable section(s)...`, 'info');

      const repeatableSectionsMap = new Map();
      repeatableSections.forEach(s => repeatableSectionsMap.set(s.sectionId, s));

      const planResponse = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          {
            action: 'ACTION_PLAN_REPEATABLE_SECTIONS',
            sections: repeatableSections.map(s => ({
              sectionId: s.sectionId,
              sectionLabel: s.sectionLabel,
              buttonText: s.buttonText,
              existingCount: s.existingCount,
              existingValues: s.existingValues,
            })),
          },
          resolve
        );
      });

      if (planResponse && planResponse.success && Array.isArray(planResponse.plans)) {
        const failures = await executeRepeatableSections(planResponse.plans, repeatableSectionsMap);
        activeRepeatableFailures.push(...failures);
      }
    }

    // 3. Scan and collect fillable field descriptors (including newly revealed repeatable inputs & drop zones)
    const descriptors = scanAndGroupFields(document);
    activeFieldMap.clear();

    for (const desc of descriptors) {
      activeFieldMap.set(desc.id, {
        descriptor: desc,
        element: desc.element,
        elements: desc.elements || (desc.element ? [desc.element] : []),
        dropZone: desc.dropZoneElement || null,
        originalValue: desc.currentValue,
        filledValue: desc.currentValue || null,
        confidence: desc.currentValue ? 0.95 : 0,
        reason: '',
        status: 'pending', // 'success' | 'failed' | 'skipped'
        methodUsed: '',
        errorMessage: null,
        attachedFileName: null,
      });
    }

    if (descriptors.length === 0) {
      showToast('No fillable form fields detected on this page.', 'warn');
      return { success: true, count: 0 };
    }

    console.debug(`[AutoFill AI] Scanned ${descriptors.length} field groups:`, descriptors);

    // Check learned answers cache or pre-filled repeatable inputs
    const resolvedFields = [];
    const unresolvedFields = [];

    for (const d of descriptors) {
      const cacheKey = normalizeLabelKey(d.label || d.name);
      if (d.type !== 'file' && learnedAnswers[cacheKey] && learnedAnswers[cacheKey].answer !== undefined) {
        resolvedFields.push({
          id: d.id,
          value: learnedAnswers[cacheKey].answer,
          confidence: 1.0,
          reason: 'Matched previously learned answer',
        });
      } else if (d.type !== 'file' && d.currentValue && String(d.currentValue).trim().length > 0) {
        // Retain values filled during repeatable section loop or existing page data
        resolvedFields.push({
          id: d.id,
          value: d.currentValue,
          confidence: 0.95,
          reason: 'Pre-filled by repeatable section or profile',
        });
      } else {
        unresolvedFields.push(d);
      }
    }

    // 3. Request LLM predictions from background for unresolved fields
    let llmResults = [];
    if (unresolvedFields.length > 0) {
      showToast(`Analyzing ${unresolvedFields.length} fields with AI...`, 'info');
      const pageContext = {
        title: document.title,
        url: window.location.href,
        heading: getTopPageHeading(),
      };

      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          {
            action: 'ACTION_MATCH_FIELDS',
            fields: unresolvedFields.map(f => ({
              id: f.id,
              name: f.name,
              type: f.type,
              label: f.label,
              placeholder: f.placeholder,
              required: f.required,
              section: f.section,
              accept: f.accept,
              options: f.options ? f.options.map(o => ({ value: o.value, text: o.text })) : undefined,
              currentValue: f.currentValue,
            })),
            pageContext,
          },
          resolve
        );
      });

      if (!response || !response.success) {
        showToast(response?.error || 'Failed to match fields with AI.', 'error');
        return { success: false, error: response?.error };
      }

      llmResults = response.results || [];
    }

    const allMatches = [...resolvedFields, ...llmResults];

    // 4. Fill values into the DOM sequentially with delay
    let filledCount = 0;
    let failedCount = 0;
    let filesAttachedCount = 0;
    const undoSnapshot = [];

    for (const match of allMatches) {
      const fieldEntry = activeFieldMap.get(match.id);
      if (!fieldEntry) continue;

      fieldEntry.confidence = match.confidence || 0;
      fieldEntry.reason = match.reason || '';

      // --- A. File Upload Fields (Resume / Document Auto-Attachment) ---
      if (fieldEntry.descriptor.type === 'file') {
        const attachResult = await handleFileUploadField(fieldEntry, match.value);

        if (attachResult.success) {
          if (!attachResult.alreadyPresent) {
            filledCount++;
            filesAttachedCount++;
          }
          fieldEntry.status = 'success';
          fieldEntry.methodUsed = attachResult.method;
          fieldEntry.filledValue = attachResult.fileName;
          fieldEntry.attachedFileName = attachResult.fileName;
          applyHighlight(fieldEntry.elements, 'high');
        } else if (attachResult.skipped) {
          fieldEntry.status = 'skipped';
          fieldEntry.methodUsed = attachResult.method;
          fieldEntry.errorMessage = attachResult.reason;
        } else {
          failedCount++;
          fieldEntry.status = 'failed';
          fieldEntry.methodUsed = attachResult.method;
          fieldEntry.errorMessage = attachResult.error || 'Failed to attach file';
          applyHighlight(fieldEntry.elements, 'unfilled');
        }

        console.debug('[AutoFill AI] File upload fill:', {
          label: fieldEntry.descriptor.label,
          classifiedType: match.value,
          fileAttached: fieldEntry.attachedFileName,
          method: fieldEntry.methodUsed,
          success: fieldEntry.status === 'success',
          error: fieldEntry.errorMessage,
          element: fieldEntry.element,
        });

        await sleep(300);
        continue;
      }

      // --- B. Standard Form Inputs, Selects, Radios, Checkboxes ---
      // Skip null/empty predictions
      if (match.value === null || match.value === undefined || match.value === '') {
        fieldEntry.status = 'skipped';
        fieldEntry.methodUsed = 'skipped-null';
        applyHighlight(fieldEntry.elements, 'unfilled');
        console.debug('[AutoFill AI] Field fill:', {
          label: fieldEntry.descriptor.label,
          chosenValue: null,
          appliedValue: null,
          method: 'skipped-null',
          success: false,
          error: 'No value provided by LLM / profile',
          element: fieldEntry.element,
        });
        continue;
      }

      // Record snapshot for undo
      undoSnapshot.push({
        entry: fieldEntry,
        previousValue: fieldEntry.originalValue,
      });

      // Execute field-specific filling
      const fillResult = await fillFieldWithStrategy(fieldEntry, match.value);

      fieldEntry.status = fillResult.success ? 'success' : 'failed';
      fieldEntry.methodUsed = fillResult.method || 'unknown';
      fieldEntry.errorMessage = fillResult.error || null;
      fieldEntry.filledValue = fillResult.appliedValue !== undefined ? fillResult.appliedValue : match.value;

      console.debug('[AutoFill AI] Field fill:', {
        label: fieldEntry.descriptor.label,
        chosenValue: match.value,
        appliedValue: fieldEntry.filledValue,
        method: fieldEntry.methodUsed,
        success: fillResult.success,
        error: fillResult.error,
        element: fieldEntry.element,
      });

      if (fillResult.success) {
        filledCount++;
        if (fieldEntry.confidence >= 0.75) {
          applyHighlight(fieldEntry.elements, 'high');
        } else {
          applyHighlight(fieldEntry.elements, 'medium');
        }
      } else {
        failedCount++;
        applyHighlight(fieldEntry.elements, 'unfilled');
      }

      // 300ms delay between fields to allow modern frameworks to re-render
      await sleep(300);
    }

    if (undoSnapshot.length > 0) {
      undoHistory.push(undoSnapshot);
    }

    // 5. Render Floating UI Badge with Upload Status
    let lastFileUploadStatus = null;
    if (filesAttachedCount > 0) {
      lastFileUploadStatus = { success: true, text: 'Resume attached' };
    } else {
      const failedFile = Array.from(activeFieldMap.values()).find(f => f.descriptor.type === 'file' && f.status === 'failed');
      if (failedFile) {
        lastFileUploadStatus = { failed: true, error: failedFile.errorMessage || 'Upload failed' };
      }
    }

    const totalFailed = failedCount + activeRepeatableFailures.length;
    renderFloatingBadge(filledCount, descriptors.length, totalFailed, filesAttachedCount, lastFileUploadStatus, activeRepeatableFailures);
    if (totalFailed > 0) {
      showToast(`AutoFill AI: Filled ${filledCount}/${descriptors.length} fields (${totalFailed} need review)`, 'warn');
    } else {
      showToast(`AutoFill AI: Filled ${filledCount} of ${descriptors.length} fields!`, 'success');
    }

    // 6. Setup dynamic mutation observer for single-page multi-step forms
    setupStepObserver();

    return { success: true, filled: filledCount, total: descriptors.length, failed: failedCount, filesAttached: filesAttachedCount };
  }

  /**
   * Handle File Upload Field Auto-Attachment
   */
  async function handleFileUploadField(fieldEntry, classifiedType, forceOverwrite = false) {
    const input = fieldEntry.element;
    const dropZone = fieldEntry.dropZone || findAssociatedDropZone(input);

    if (!cachedAutoAttachSetting) {
      return { skipped: true, method: 'setting-disabled', reason: 'Auto-attach resume disabled in extension settings' };
    }

    // Skip if field already has a file attached, unless force overwrite
    if (!forceOverwrite && input.files && input.files.length > 0) {
      return {
        success: true,
        alreadyPresent: true,
        fileName: input.files[0].name,
        method: 'file-already-present',
      };
    }

    // Find matching document among stored files
    const match = selectMatchingStoredFile(classifiedType, cachedStoredFiles, cachedFallbackResume);
    if (!match.file) {
      return {
        skipped: true,
        method: 'no-matching-file',
        reason: match.reason,
      };
    }

    const fileObj = match.file;

    // Check accept attribute compatibility
    const acceptAttr = fieldEntry.descriptor.accept || input.getAttribute('accept');
    if (acceptAttr && !isFileTypeAccepted(fileObj, acceptAttr)) {
      return {
        success: false,
        method: 'file-accept-mismatch',
        error: `File "${fileObj.name}" is not accepted by this field (accepts: "${acceptAttr}")`,
      };
    }

    // Attempt DataTransfer attachment
    const attachResult = await executeDataTransferAttachment(input, dropZone, fileObj, cachedStoredFiles);
    if (!attachResult.success) {
      // Retry once after brief pause
      await sleep(250);
      const retryResult = await executeDataTransferAttachment(input, dropZone, fileObj, cachedStoredFiles);
      return retryResult;
    }

    return attachResult;
  }

  /**
   * Execute DataTransfer file creation, input assignment, and event dispatch
   */
  async function executeDataTransferAttachment(input, dropZone, fileObj, allStoredFiles = []) {
    try {
      const byteCharacters = atob(fileObj.base64);
      const byteArrays = [];
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
      }

      const blob = new Blob(byteArrays, { type: fileObj.type || 'application/pdf' });
      const file = new File([blob], fileObj.name || 'Resume.pdf', {
        type: fileObj.type || 'application/pdf',
        lastModified: Date.now(),
      });

      const dt = new DataTransfer();
      dt.items.add(file);

      // Respect the multiple attribute: attach secondary documents if present
      if (input.hasAttribute('multiple') && Array.isArray(allStoredFiles)) {
        for (const extra of allStoredFiles) {
          if (extra && extra.base64 && extra.name !== fileObj.name) {
            try {
              const extraBytes = atob(extra.base64);
              const extraChunks = [];
              for (let o = 0; o < extraBytes.length; o += 512) {
                const s = extraBytes.slice(o, o + 512);
                const n = new Array(s.length);
                for (let j = 0; j < s.length; j++) n[j] = s.charCodeAt(j);
                extraChunks.push(new Uint8Array(n));
              }
              const extraBlob = new Blob(extraChunks, { type: extra.type || 'application/pdf' });
              const extraFile = new File([extraBlob], extra.name, {
                type: extra.type || 'application/pdf',
                lastModified: Date.now(),
              });
              dt.items.add(extraFile);
            } catch (_) {}
          }
        }
      }

      // Assign to file input
      input.files = dt.files;

      // Dispatch bubbling input and change events so React/Vue/Angular detect the file
      dispatchEvents(input);

      // If site uses custom drop zone, also dispatch dragenter, dragover, and drop events with DataTransfer
      if (dropZone) {
        const rect = dropZone.getBoundingClientRect ? dropZone.getBoundingClientRect() : { left: 0, top: 0 };
        const dragInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          dataTransfer: dt,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        };

        dropZone.dispatchEvent(new DragEvent('dragenter', dragInit));
        dropZone.dispatchEvent(new DragEvent('dragover', dragInit));
        dropZone.dispatchEvent(new DragEvent('drop', dragInit));
      }

      // Verification: Check input.files.length > 0
      const hasFiles = input.files && input.files.length > 0;
      if (!hasFiles) {
        return {
          success: false,
          method: 'file-datatransfer-failed',
          error: 'File input did not retain DataTransfer file',
        };
      }

      // Verify that page reflects the file name (poll up to 2.0s)
      await verifyFileNameRenderedOnPage(input, dropZone, fileObj.name, 2000);

      return {
        success: true,
        method: dropZone ? 'file-datatransfer-dropzone' : 'file-datatransfer-input',
        fileName: fileObj.name,
      };
    } catch (err) {
      return {
        success: false,
        method: 'file-attachment-exception',
        error: err.message,
      };
    }
  }

  /**
   * Verify if page updated to display the attached file's name
   */
  async function verifyFileNameRenderedOnPage(input, dropZone, fileName, timeoutMs = 1500) {
    const startTime = Date.now();
    const cleanName = fileName.toLowerCase();

    while (Date.now() - startTime < timeoutMs) {
      const container = dropZone || input.parentElement;
      if (container && container.innerText.toLowerCase().includes(cleanName)) {
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  /**
   * Select best matching document from stored files based on classified type
   */
  function selectMatchingStoredFile(classifiedType, storedFiles, fallbackResume) {
    // Explicitly skip photos or ID proof fields unless user has specific config
    if (classifiedType === 'photo') {
      return { file: null, reason: 'Skipped photo upload field' };
    }
    if (classifiedType === 'id') {
      return { file: null, reason: 'Skipped ID upload field' };
    }

    const targetType = String(classifiedType || 'resume').toLowerCase();

    // 1. Direct label match in stored files
    if (storedFiles && storedFiles.length > 0) {
      if (targetType === 'cover_letter') {
        const coverDoc = storedFiles.find(d => d.label === 'cover_letter');
        if (coverDoc) return { file: coverDoc, reason: 'Matched stored Cover Letter' };
      }

      if (targetType === 'other_document') {
        const otherDoc = storedFiles.find(d => d.label === 'other_document');
        if (otherDoc) return { file: otherDoc, reason: 'Matched stored Document' };
      }

      // Default or resume: prefer default resume marker
      const defaultResume =
        storedFiles.find(d => d.label === 'resume' && d.isDefault) ||
        storedFiles.find(d => d.isDefault) ||
        storedFiles.find(d => d.label === 'resume') ||
        storedFiles[0];

      if (defaultResume) {
        return { file: defaultResume, reason: 'Matched default Resume' };
      }
    }

    // 2. Fallback primary resume file
    if (fallbackResume && fallbackResume.base64) {
      return { file: fallbackResume, reason: 'Matched primary fallback resume' };
    }

    return { file: null, reason: 'No matching document found in AutoFill AI storage' };
  }

  /**
   * Verify file compatibility with input accept attribute
   */
  function isFileTypeAccepted(fileObj, acceptAttr) {
    if (!acceptAttr || !acceptAttr.trim()) return true;
    const tokens = acceptAttr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return true;

    const fileName = (fileObj.name || '').toLowerCase();
    const fileExt = '.' + (fileName.split('.').pop() || '');
    const mime = (fileObj.type || '').toLowerCase();

    for (const token of tokens) {
      if (token.startsWith('.')) {
        if (fileExt === token) return true;
      } else if (token.includes('/*')) {
        const prefix = token.split('/')[0];
        if (mime.startsWith(prefix + '/')) return true;
      } else if (token === mime) {
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // REPEATABLE SECTIONS ENGINE ("+ Add more", "+ Add website", "+ Add experience")
  // =========================================================================

  const ADD_BUTTON_REGEX = /(?:\+\s*add|add\s+(?:another|more|new|website|link|url|social|experience|employment|job|education|school|skill|language|certification|certificate|license|project|publication|reference|row|item)|^\s*\+\s*$|^\s*\+\s*add\b)/i;
  const REMOVE_BUTTON_REGEX = /(?:remove|delete|trash|cancel|clear|close|dismiss|hide)/i;
  const SUBMIT_BUTTON_REGEX = /(?:submit|apply now|send application|finish|complete application)/i;

  const RELEVANT_SECTION_KEYWORDS = [
    'website', 'link', 'url', 'portfolio', 'social', 'github', 'linkedin', 'twitter', 'blog',
    'experience', 'employment', 'job', 'work history', 'career', 'position', 'employer',
    'education', 'school', 'university', 'college', 'degree', 'academic',
    'skill', 'technolog', 'competenc',
    'language',
    'certification', 'certificate', 'license', 'credential',
    'project', 'publication', 'reference', 'award'
  ];

  /**
   * Detect all repeatable "+ Add ..." buttons and identify their respective sections
   */
  function detectRepeatableSections(rootNode) {
    const candidateButtons = Array.from(
      rootNode.querySelectorAll('button, a, [role="button"], [data-automation-id*="add"], [data-testid*="add"], div, span')
    );

    const sections = [];
    const seenButtons = new Set();
    let secCounter = 1;

    for (const el of candidateButtons) {
      if (seenButtons.has(el)) continue;
      if (!isElementVisible(el)) continue;

      const tag = el.tagName.toLowerCase();
      const isButtonRole = tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button' || el.hasAttribute('onclick');
      if (!isButtonRole) {
        try {
          const style = window.getComputedStyle(el);
          if (!style || style.cursor !== 'pointer') continue;
        } catch (_) {
          continue;
        }
      }

      const text = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
      if (!text || text.length > 70) continue;

      if (!ADD_BUTTON_REGEX.test(text)) continue;
      if (REMOVE_BUTTON_REGEX.test(text) || SUBMIT_BUTTON_REGEX.test(text)) continue;

      // Determine section label from preceding heading/label or button text
      const sectionLabel = findPrecedingSectionLabel(el);
      const combined = `${sectionLabel} ${text}`.toLowerCase();
      const isRelevant = RELEVANT_SECTION_KEYWORDS.some(kw => combined.includes(kw));

      if (!isRelevant) {
        console.debug('[AutoFill AI] Skipping non-profile add button:', text, 'Section:', sectionLabel);
        continue;
      }

      seenButtons.add(el);

      // Determine the section container
      const container =
        el.closest('fieldset, section, [class*="section"], [class*="group"], [class*="card"], [class*="container"], form, div') ||
        el.parentElement;

      // Scan existing inputs in container
      const existingInputs = Array.from(
        container.querySelectorAll('input:not([type="hidden"]), select, textarea')
      ).filter(inp => isElementVisible(inp));

      const existingValues = existingInputs
        .map(i => i.value ? i.value.trim() : '')
        .filter(v => v.length > 0 && v !== 'on');

      sections.push({
        sectionId: `sec_repeat_${secCounter++}`,
        sectionLabel: sectionLabel || text,
        buttonText: text,
        buttonElement: el,
        containerElement: container,
        existingCount: existingValues.length,
        existingValues,
      });
    }

    return sections;
  }

  function findPrecedingSectionLabel(button) {
    // 1. Closest container's heading or legend
    const container = button.closest('fieldset, section, [class*="section"], [class*="group"], [class*="card"], [class*="container"], div');
    if (container) {
      const heading = container.querySelector('legend, h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"], label');
      if (heading && heading !== button && !heading.contains(button)) {
        const txt = cleanLabelText(heading.innerText);
        if (txt && txt.length > 2) return txt;
      }
    }

    // 2. Look backward through preceding siblings
    let prev = button.previousElementSibling;
    while (prev) {
      if (/h[1-6]|legend|label/i.test(prev.tagName) || prev.matches('[class*="title"], [class*="heading"], [class*="label"]')) {
        const txt = cleanLabelText(prev.innerText);
        if (txt && txt.length > 2) return txt;
      }
      prev = prev.previousElementSibling;
    }

    // 3. Parent's previous sibling
    if (button.parentElement) {
      let parentPrev = button.parentElement.previousElementSibling;
      while (parentPrev) {
        if (/h[1-6]|legend|label/i.test(parentPrev.tagName) || parentPrev.matches('[class*="title"], [class*="heading"], [class*="label"]')) {
          const txt = cleanLabelText(parentPrev.innerText);
          if (txt && txt.length > 2) return txt;
        }
        parentPrev = parentPrev.previousElementSibling;
      }
    }

    // 4. Fallback to button's own text without "+ Add"
    const btnText = (button.innerText || button.getAttribute('aria-label') || '').trim();
    return cleanLabelText(btnText.replace(/^\+?\s*add\s+/i, '')) || 'Repeatable Section';
  }

  /**
   * Execution loop for repeatable sections
   */
  async function executeRepeatableSections(plans, sectionsMap) {
    const failures = [];

    for (const plan of plans) {
      if (!plan || !plan.items || plan.items.length === 0 || plan.itemsToAdd <= 0) {
        continue;
      }

      const secInfo = sectionsMap.get(plan.sectionId);
      if (!secInfo || !secInfo.buttonElement) continue;

      const { buttonElement, containerElement, sectionLabel, buttonText } = secInfo;
      const itemsToProcess = plan.items.slice(0, 10); // Cap at 10 to avoid infinite loops

      console.debug(`[AutoFill AI] Executing repeatable section "${sectionLabel}" with ${itemsToProcess.length} planned items.`);

      let itemIndex = 0;
      for (const item of itemsToProcess) {
        itemIndex++;
        const cleanName = sectionLabel.replace(/[:+]/g, '').trim() || 'item';
        updateFloatingBadgeProgress(`Adding ${cleanName} ${itemIndex}/${itemsToProcess.length}...`);
        showToast(`AutoFill AI: Adding ${cleanName} ${itemIndex}/${itemsToProcess.length}...`, 'info');

        // Step 5: If first empty row already exists on the page (visible without clicking), fill that one first
        const existingEmptyFields = findEmptyInputsInSection(containerElement);
        let fieldsToFill = [];

        if (existingEmptyFields.length > 0 && itemIndex === 1) {
          fieldsToFill = existingEmptyFields;
          console.debug(`[AutoFill AI] Using existing empty fields in "${sectionLabel}" for item 1.`);
        } else {
          // Idempotence check: check if this item's primary value is already present on the page
          const mainVal = Object.values(item).find(v => typeof v === 'string' && v.length > 3);
          if (mainVal && pageContainsValue(containerElement, mainVal)) {
            console.debug(`[AutoFill AI] Skipping duplicate item for "${sectionLabel}":`, mainVal);
            continue;
          }

          // Step 1: Scroll button into view and dispatch full mouse sequence
          const priorElements = new Set(
            document.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"], [contenteditable="true"]')
          );

          try {
            buttonElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (_) {}

          await sleep(150);
          dispatchFullClick(buttonElement);

          // Step 2: Wait up to 2s (MutationObserver) for new inputs/selects to appear
          const newElements = await waitForNewElements(priorElements, containerElement, 2000);

          if (newElements.length === 0) {
            console.warn(`[AutoFill AI] Click produced no new fields for "${sectionLabel}". Stopping loop.`);
            failures.push({
              section: sectionLabel,
              message: `Could not add a row for ${sectionLabel}`,
            });
            break; // Stop if the click produces no new fields
          }

          fieldsToFill = newElements;
        }

        // Step 3: Build descriptors for just the new fields and fill them
        let filledCount = 0;
        for (const el of fieldsToFill) {
          const desc = buildFieldDescriptor(el, `repeat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
          desc.element = el;
          desc.elements = [el];

          const targetValue = matchItemPropertyToField(item, desc);
          if (targetValue !== undefined && targetValue !== null && targetValue !== '') {
            const fieldEntry = {
              descriptor: desc,
              element: el,
              elements: [el],
              originalValue: desc.currentValue,
              confidence: 0.95,
              reason: `Auto-filled repeatable ${sectionLabel}`,
            };

            const fillRes = await fillFieldWithStrategy(fieldEntry, targetValue);
            if (fillRes.success) {
              filledCount++;
              applyHighlight([el], 'high');
            }

            console.debug('[AutoFill AI] Repeatable field fill:', {
              section: sectionLabel,
              field: desc.label || desc.name,
              value: targetValue,
              success: fillRes.success,
            });
          }
        }

        // Step 4: Verify that value stuck and check for inline "Save" / "Done" / "Add" / "Confirm" button
        const confirmBtn = findRowConfirmButton(fieldsToFill, containerElement);
        if (confirmBtn) {
          dispatchFullClick(confirmBtn);
          await sleep(300);
        }

        console.debug('[AutoFill AI] Repeatable section step completed:', {
          section: sectionLabel,
          buttonClicked: buttonText,
          newFieldsFound: fieldsToFill.length,
          valuesFilled: item,
          success: filledCount > 0,
        });

        // Add 300-500ms delay after each click for re-rendering
        await sleep(400);
      }
    }

    return failures;
  }

  function findEmptyInputsInSection(containerElement) {
    if (!containerElement) return [];
    const inputs = Array.from(
      containerElement.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')
    ).filter(el => isElementVisible(el));

    if (inputs.length === 0) return [];

    const allEmpty = inputs.every(el => {
      if (el.tagName.toLowerCase() === 'select') {
        return !el.value || el.selectedIndex === 0 || el.value === '';
      }
      return !el.value || el.value.trim() === '';
    });

    return allEmpty ? inputs : [];
  }

  function pageContainsValue(containerElement, valueToFind) {
    if (!containerElement || !valueToFind) return false;
    const cleanFind = String(valueToFind).trim().toLowerCase();
    if (cleanFind.length < 3) return false;

    const inputs = Array.from(containerElement.querySelectorAll('input, select, textarea'));
    for (const inp of inputs) {
      const val = String(inp.value || '').trim().toLowerCase();
      if (val === cleanFind || (cleanFind.length > 5 && (val.includes(cleanFind) || cleanFind.includes(val)))) {
        return true;
      }
    }

    const text = containerElement.innerText.toLowerCase();
    if (text.includes(cleanFind)) {
      return true;
    }

    return false;
  }

  function waitForNewElements(priorElements, containerElement, timeoutMs = 2000) {
    return new Promise(resolve => {
      function getNew() {
        const candidates = document.querySelectorAll(
          'input:not([type="hidden"]), select, textarea, [role="combobox"], [contenteditable="true"]'
        );
        return Array.from(candidates).filter(el => !priorElements.has(el) && isElementVisible(el));
      }

      const immediate = getNew();
      if (immediate.length > 0) {
        return resolve(immediate);
      }

      let resolved = false;
      const observer = new MutationObserver(() => {
        const found = getNew();
        if (found.length > 0 && !resolved) {
          resolved = true;
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(getNew());
        }
      }, timeoutMs);
    });
  }

  function matchItemPropertyToField(item, desc) {
    if (!item || typeof item !== 'object') return null;

    const label = (desc.label || desc.name || desc.placeholder || '').toLowerCase();
    const isDropdown =
      desc.type === 'select-one' ||
      desc.type === 'combobox' ||
      (desc.element && desc.element.tagName.toLowerCase() === 'select');

    // 1. Website / link row: type dropdown vs url input
    if (isDropdown || /type|category|label|platform|kind/i.test(label)) {
      if (item.type !== undefined) return item.type;
      if (item.category !== undefined) return item.category;
      if (item.label !== undefined) return item.label;
      if (item.platform !== undefined) return item.platform;
    }

    if (/url|link|website|address|href/i.test(label) || desc.type === 'url') {
      if (item.url !== undefined) return item.url;
      if (item.link !== undefined) return item.link;
      if (item.website !== undefined) return item.website;
    }

    // 2. Experience fields
    if (/company|employer|organization|workplace/i.test(label)) {
      if (item.company !== undefined) return item.company;
      if (item.employer !== undefined) return item.employer;
    }
    if (/title|role|position|job/i.test(label)) {
      if (item.title !== undefined) return item.title;
      if (item.role !== undefined) return item.role;
      if (item.position !== undefined) return item.position;
    }
    if (/start|from/i.test(label)) {
      if (item.startDate !== undefined) return item.startDate;
      if (item.from !== undefined) return item.from;
    }
    if (/end|to|until/i.test(label)) {
      if (item.endDate !== undefined) return item.endDate;
      if (item.to !== undefined) return item.to;
    }
    if (/desc|summary|detail|responsibilit/i.test(label)) {
      if (item.description !== undefined) return item.description;
      if (item.summary !== undefined) return item.summary;
    }

    // 3. Education fields
    if (/school|university|college|institution/i.test(label)) {
      if (item.school !== undefined) return item.school;
      if (item.university !== undefined) return item.university;
    }
    if (/degree/i.test(label)) {
      if (item.degree !== undefined) return item.degree;
    }
    if (/field|major|study/i.test(label)) {
      if (item.field !== undefined) return item.field;
      if (item.major !== undefined) return item.major;
    }
    if (/grad|year/i.test(label)) {
      if (item.gradYear !== undefined) return item.gradYear;
      if (item.year !== undefined) return item.year;
    }

    // 4. Skills / languages / certifications
    if (/skill|competenc/i.test(label)) {
      if (item.skill !== undefined) return item.skill;
      if (item.name !== undefined) return item.name;
    }
    if (/language/i.test(label)) {
      if (item.language !== undefined) return item.language;
    }
    if (/proficiency|level/i.test(label)) {
      if (item.proficiency !== undefined) return item.proficiency;
      if (item.level !== undefined) return item.level;
    }
    if (/certif|license/i.test(label)) {
      if (item.certification !== undefined) return item.certification;
      if (item.name !== undefined) return item.name;
    }

    // 5. Fallback: key matching
    for (const [key, val] of Object.entries(item)) {
      if (label.includes(key.toLowerCase())) {
        return val;
      }
    }

    const values = Object.values(item).filter(v => v !== null && v !== undefined && typeof v !== 'object');
    if (values.length === 1) {
      return values[0];
    }

    return null;
  }

  function findRowConfirmButton(newElements, containerElement) {
    if (!newElements || newElements.length === 0) return null;

    // A. Check if inside modal/dialog
    const modal = newElements[0].closest('[role="dialog"], dialog, .modal, [class*="modal"]');
    if (modal) {
      const modalBtns = Array.from(modal.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
      const confirmBtn = modalBtns.find(b => {
        const txt = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (/submit|apply now|send application|cancel|close|delete/i.test(txt)) return false;
        return /^(?:save|done|add|confirm|ok|insert|apply row|continue)$/i.test(txt) || b.classList.contains('btn-primary');
      });
      if (confirmBtn) return confirmBtn;
    }

    // B. Check row container
    const row = newElements[0].closest('[class*="row"], [class*="item"], [class*="entry"], tr, .form-group') || containerElement;
    if (row) {
      const rowBtns = Array.from(row.querySelectorAll('button, [role="button"]'));
      const confirmBtn = rowBtns.find(b => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (/submit|apply now|send application|cancel|close|delete|trash|remove/i.test(txt)) return false;
        return /^(?:save|done|add|confirm|ok|insert|apply row)$/i.test(txt);
      });
      if (confirmBtn) return confirmBtn;
    }

    return null;
  }

  function updateFloatingBadgeProgress(message) {
    if (floatingBadgeEl) {
      const textEl = floatingBadgeEl.querySelector('.autofill-badge-text');
      if (textEl) {
        textEl.innerHTML = `<span style="color:#60a5fa;font-weight:600;">⚡ ${escapeHtml(message)}</span>`;
      }
    }
  }

  /**
   * Field Scanner with Radio Grouping, Checkbox Grouping, Custom Combobox, and Dropzone Detection
   */
  function scanAndGroupFields(rootNode) {
    const rawElements = collectAllCandidateElements(rootNode);
    const descriptors = [];
    const processedRadioNames = new Set();
    const processedRadioElements = new Set();
    const processedCheckboxElements = new Set();
    let fieldCounter = 1;

    for (const el of rawElements) {
      if (shouldIgnoreElement(el)) continue;

      const tag = el.tagName.toLowerCase();
      const type = (el.type || tag).toLowerCase();

      // --- 1. File Upload Fields (Resume, CV, Documents) ---
      if (type === 'file') {
        const dropZone = findAssociatedDropZone(el);
        const label = findSmartLabel(el) || 'Resume / Document Upload';
        const section = findSectionHeading(el);
        const accept = el.getAttribute('accept') || '';
        const multiple = el.hasAttribute('multiple');
        const hasExisting = Boolean(el.files && el.files.length > 0);
        const existingName = hasExisting ? el.files[0].name : '';

        descriptors.push({
          id: `field_${fieldCounter++}`,
          name: el.name || el.id || 'file_upload',
          type: 'file',
          label,
          placeholder: '',
          required: el.required || el.getAttribute('aria-required') === 'true',
          section,
          accept,
          multiple,
          currentValue: existingName,
          element: el,
          elements: [el, dropZone].filter(Boolean),
          dropZoneElement: dropZone,
        });
        continue;
      }

      // --- 2. Radio Button Grouping ---
      if (type === 'radio') {
        if (processedRadioElements.has(el)) continue;

        const groupName = el.name ? el.name.trim() : null;
        const groupContainer = el.closest('fieldset, [role="radiogroup"]');

        let radioNodes = [];
        if (groupName) {
          if (processedRadioNames.has(groupName)) continue;
          processedRadioNames.add(groupName);
          radioNodes = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`));
        } else if (groupContainer) {
          radioNodes = Array.from(groupContainer.querySelectorAll('input[type="radio"]'));
        } else {
          radioNodes = [el];
        }

        radioNodes.forEach(r => processedRadioElements.add(r));

        const groupLabel = findGroupQuestionLabel(el, groupContainer, groupName);
        const options = radioNodes.map(r => {
          const optLabel = findOptionLabel(r);
          return {
            value: r.value || optLabel,
            text: optLabel,
            element: r,
            labelElement: findAssociatedLabelElement(r),
          };
        });

        const checkedRadio = radioNodes.find(r => r.checked);
        const currentValue = checkedRadio ? (findOptionLabel(checkedRadio) || checkedRadio.value) : '';

        descriptors.push({
          id: `field_${fieldCounter++}`,
          name: groupName || el.id || 'radio_group',
          type: 'radio',
          isGroup: true,
          label: groupLabel,
          placeholder: '',
          required: radioNodes.some(r => r.required || r.getAttribute('aria-required') === 'true'),
          section: findSectionHeading(el),
          currentValue,
          options,
          element: radioNodes[0],
          elements: radioNodes,
        });
        continue;
      }

      // --- 3. Checkbox Grouping (Multi-select) vs Standalone Checkbox ---
      if (type === 'checkbox') {
        if (processedCheckboxElements.has(el)) continue;

        const groupName = el.name ? el.name.trim() : null;
        const groupContainer = el.closest('fieldset, [role="group"]');

        let siblingCheckboxes = [];
        if (groupName && groupName.endsWith('[]')) {
          siblingCheckboxes = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(groupName)}"]`));
        } else if (groupContainer) {
          siblingCheckboxes = Array.from(groupContainer.querySelectorAll('input[type="checkbox"]'));
        } else if (groupName) {
          const matchingName = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(groupName)}"]`));
          if (matchingName.length > 1) {
            siblingCheckboxes = matchingName;
          }
        }

        if (siblingCheckboxes.length > 1) {
          siblingCheckboxes.forEach(cb => processedCheckboxElements.add(cb));
          const groupLabel = findGroupQuestionLabel(el, groupContainer, groupName);
          const options = siblingCheckboxes.map(cb => {
            const optLabel = findOptionLabel(cb);
            return {
              value: cb.value || optLabel,
              text: optLabel,
              element: cb,
              labelElement: findAssociatedLabelElement(cb),
            };
          });

          const currentChecked = siblingCheckboxes
            .filter(cb => cb.checked)
            .map(cb => findOptionLabel(cb) || cb.value);

          descriptors.push({
            id: `field_${fieldCounter++}`,
            name: groupName || el.id || 'checkbox_group',
            type: 'checkbox-group',
            isGroup: true,
            label: groupLabel,
            placeholder: '',
            required: siblingCheckboxes.some(cb => cb.required || cb.getAttribute('aria-required') === 'true'),
            section: findSectionHeading(el),
            currentValue: currentChecked,
            options,
            element: siblingCheckboxes[0],
            elements: siblingCheckboxes,
          });
          continue;
        }

        // Standalone single checkbox
        processedCheckboxElements.add(el);
        const label = findOptionLabel(el) || findSmartLabel(el);
        descriptors.push({
          id: `field_${fieldCounter++}`,
          name: el.name || el.id || 'checkbox',
          type: 'checkbox',
          label,
          placeholder: '',
          required: el.required || el.getAttribute('aria-required') === 'true',
          section: findSectionHeading(el),
          currentValue: el.checked,
          element: el,
          elements: [el],
        });
        continue;
      }

      // --- 4. Custom Dropdowns / Comboboxes ---
      const isCustomDropdown = isCustomDropdownElement(el);
      if (isCustomDropdown) {
        const label = findSmartLabel(el);
        const required = el.getAttribute('aria-required') === 'true' || Boolean(el.closest('[required]'));
        const options = extractCurrentComboboxOptions(el);

        descriptors.push({
          id: `field_${fieldCounter++}`,
          name: el.getAttribute('name') || el.id || 'custom_select',
          type: 'combobox',
          isCustomDropdown: true,
          label,
          placeholder: el.getAttribute('placeholder') || el.innerText.trim() || '',
          required,
          section: findSectionHeading(el),
          currentValue: el.innerText.trim() || el.getAttribute('value') || '',
          options,
          element: el,
          elements: [el],
        });
        continue;
      }

      // --- 5. Native <select> ---
      if (tag === 'select') {
        const label = findSmartLabel(el);
        const options = Array.from(el.options).map((opt, idx) => ({
          index: idx,
          value: opt.value,
          text: (opt.text || opt.innerText || '').trim(),
          element: opt,
        }));

        descriptors.push({
          id: `field_${fieldCounter++}`,
          name: el.name || el.id || 'select',
          type: el.multiple ? 'select-multiple' : 'select-one',
          label,
          placeholder: '',
          required: el.required || el.getAttribute('aria-required') === 'true',
          section: findSectionHeading(el),
          currentValue: el.multiple
            ? Array.from(el.selectedOptions).map(o => o.value)
            : el.value,
          options,
          element: el,
          elements: [el],
        });
        continue;
      }

      // --- 6. Standard Inputs (Text, Email, Number, Date, Textarea) ---
      const fieldDesc = buildFieldDescriptor(el, `field_${fieldCounter++}`);
      if (fieldDesc) {
        fieldDesc.element = el;
        fieldDesc.elements = [el];
        descriptors.push(fieldDesc);
      }
    }

    return descriptors;
  }

  /**
   * Find drop zone element associated with a file input
   * Detects elements with "upload", "dropzone", "drag" in class or text, or role="button" next to hidden input.
   */
  function findAssociatedDropZone(fileInput) {
    if (!fileInput) return null;

    // 1. Closest element with dropzone/upload/drag classes
    const container = fileInput.closest(
      '[class*="dropzone"], [class*="upload"], [class*="drop-zone"], [class*="drag"], [class*="file-upload"], [class*="file-drop"], [data-dropzone="true"], [data-automation-id*="upload"]'
    );
    if (container) return container;

    // 2. Next or previous sibling button or drop area
    let sibling = fileInput.nextElementSibling;
    while (sibling) {
      if (
        sibling.matches('button, [role="button"], [class*="upload"], [class*="dropzone"], [class*="file"]') ||
        sibling.querySelector('button, [role="button"], [class*="upload"]')
      ) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }

    let prev = fileInput.previousElementSibling;
    while (prev) {
      if (
        prev.matches('button, [role="button"], [class*="upload"], [class*="dropzone"], [class*="file"]') ||
        prev.querySelector('button, [role="button"], [class*="upload"]')
      ) {
        return prev;
      }
      prev = prev.previousElementSibling;
    }

    // 3. Parent container
    if (fileInput.parentElement && fileInput.parentElement.tagName.toLowerCase() !== 'body') {
      return fileInput.parentElement;
    }

    return null;
  }

  /**
   * Determine if element is a custom dropdown (React-Select, MUI, Ant Design, Workday, etc.)
   */
  function isCustomDropdownElement(el) {
    if (!el || el.tagName.toLowerCase() === 'select') return false;

    const role = el.getAttribute('role');
    const hasPopup = el.getAttribute('aria-haspopup');
    const className = String(el.className || '').toLowerCase();

    if (role === 'combobox') return true;
    if (hasPopup === 'listbox' || hasPopup === 'true') return true;

    if (
      className.includes('select__control') ||
      className.includes('ant-select-selector') ||
      className.includes('muiselect') ||
      className.includes('react-select') ||
      className.includes('custom-select') ||
      el.matches('[data-automation-id*="select"], [data-uxi-select="true"], [data-testid*="select"]')
    ) {
      return true;
    }

    if (className.includes('select') || className.includes('dropdown')) {
      if (
        el.getAttribute('tabindex') !== null ||
        el.getAttribute('aria-expanded') !== null ||
        el.onclick ||
        role === 'button' ||
        el.tagName.toLowerCase() === 'button' ||
        (el.tagName.toLowerCase() === 'input' && (el.readOnly || el.getAttribute('aria-autocomplete') === 'list'))
      ) {
        return true;
      }
    }

    return false;
  }

  function extractCurrentComboboxOptions(el) {
    const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (listboxId) {
      const listbox = document.getElementById(listboxId);
      if (listbox) {
        const opts = listbox.querySelectorAll('[role="option"], [role="treeitem"], li');
        return Array.from(opts).map(o => ({
          value: o.getAttribute('data-value') || o.getAttribute('value') || o.innerText.trim(),
          text: o.innerText.trim(),
          element: o,
        }));
      }
    }
    return [];
  }

  /**
   * Master Strategy Resolver for Field Filling
   */
  async function fillFieldWithStrategy(fieldEntry, targetValue) {
    const { descriptor, element } = fieldEntry;
    const type = descriptor.type;

    if (type === 'select-one' || type === 'select-multiple' || element.tagName.toLowerCase() === 'select') {
      return fillNativeSelect(element, targetValue);
    }

    if (type === 'radio' || (descriptor.isGroup && descriptor.options && descriptor.options[0]?.element?.type === 'radio')) {
      return fillRadioGroup(fieldEntry, targetValue);
    }

    if (type === 'checkbox-group') {
      return fillCheckboxGroup(fieldEntry, targetValue);
    }

    if (type === 'checkbox') {
      return fillSingleCheckbox(fieldEntry, targetValue);
    }

    if (type === 'combobox' || descriptor.isCustomDropdown) {
      return fillCustomDropdown(fieldEntry, targetValue);
    }

    return fillStandardInput(element, targetValue);
  }

  function fillNativeSelect(selectEl, targetValue) {
    if (!selectEl || !selectEl.options) {
      return { success: false, error: 'Element is not a valid select', method: 'native-select-invalid' };
    }

    const matchedOption = findBestOptionMatch(selectEl.options, targetValue);
    if (!matchedOption) {
      const available = Array.from(selectEl.options).map(o => `"${o.text}"`).slice(0, 8).join(', ');
      return {
        success: false,
        error: `Could not match "${targetValue}" with options: [${available}${selectEl.options.length > 8 ? '...' : ''}]`,
        method: 'native-select-nomatch',
      };
    }

    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(selectEl, matchedOption.value);
      } else {
        selectEl.value = matchedOption.value;
      }

      if (matchedOption.index !== undefined) {
        selectEl.selectedIndex = matchedOption.index;
      }

      dispatchEvents(selectEl);
      const isVerified = selectEl.value === matchedOption.value || selectEl.selectedIndex === matchedOption.index;

      return {
        success: isVerified,
        method: 'native-select',
        appliedValue: matchedOption.text || matchedOption.value,
        error: isVerified ? null : 'Native select value did not update after dispatching events',
      };
    } catch (err) {
      return { success: false, method: 'native-select-error', error: err.message };
    }
  }

  async function fillRadioGroup(fieldEntry, targetValue) {
    const options = fieldEntry.descriptor.options || [];
    if (options.length === 0) {
      return { success: false, error: 'Radio group has no options', method: 'radio-no-options' };
    }

    const matchedOption = findBestOptionMatch(options, targetValue);
    if (!matchedOption) {
      const available = options.map(o => `"${o.text}"`).join(', ');
      return {
        success: false,
        error: `Option "${targetValue}" not found among radio options: [${available}]`,
        method: 'radio-nomatch',
      };
    }

    const targetRadio = matchedOption.element;
    const targetLabel = matchedOption.labelElement || findAssociatedLabelElement(targetRadio);

    if (!targetRadio) {
      return { success: false, error: 'Target radio element reference missing', method: 'radio-missing' };
    }

    try {
      (targetLabel || targetRadio).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}

    if (targetRadio.checked) {
      return {
        success: true,
        method: 'radio-already-checked',
        appliedValue: matchedOption.text || targetRadio.value,
      };
    }

    let clickMethod = 'radio-input-click';
    const isVisible = isElementVisible(targetRadio);

    if (isVisible) {
      dispatchFullClick(targetRadio);
    } else if (targetLabel) {
      clickMethod = 'radio-label-click';
      dispatchFullClick(targetLabel);
    } else {
      dispatchFullClick(targetRadio);
    }

    if (targetRadio.checked) {
      dispatchEvents(targetRadio);
      return {
        success: true,
        method: clickMethod,
        appliedValue: matchedOption.text || targetRadio.value,
      };
    }

    if (targetLabel && clickMethod !== 'radio-label-click') {
      dispatchFullClick(targetLabel);
      if (targetRadio.checked) {
        dispatchEvents(targetRadio);
        return {
          success: true,
          method: 'radio-label-retry',
          appliedValue: matchedOption.text || targetRadio.value,
        };
      }
    }

    if (targetRadio.parentElement) {
      dispatchFullClick(targetRadio.parentElement);
      if (targetRadio.checked) {
        dispatchEvents(targetRadio);
        return {
          success: true,
          method: 'radio-parent-click',
          appliedValue: matchedOption.text || targetRadio.value,
        };
      }
    }

    try {
      const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
      if (checkedSetter) {
        checkedSetter.call(targetRadio, true);
      } else {
        targetRadio.checked = true;
      }
      dispatchEvents(targetRadio);
      return {
        success: targetRadio.checked,
        method: 'radio-prototype-forced',
        appliedValue: matchedOption.text || targetRadio.value,
      };
    } catch (err) {
      return { success: false, method: 'radio-failed', error: err.message };
    }
  }

  async function fillSingleCheckbox(fieldEntry, targetValue) {
    const input = fieldEntry.element;
    if (!input) return { success: false, error: 'Missing checkbox element', method: 'checkbox-missing' };

    const shouldCheck = Boolean(
      targetValue === true ||
      targetValue === 'true' ||
      targetValue === 1 ||
      /^(yes|checked|true|agree|accept|on|1)$/i.test(String(targetValue).trim())
    );

    if (input.checked === shouldCheck) {
      return {
        success: true,
        method: 'checkbox-already-correct',
        appliedValue: shouldCheck ? 'Checked' : 'Unchecked',
      };
    }

    const label = findAssociatedLabelElement(input);
    const isVisible = isElementVisible(input);

    if (isVisible) {
      dispatchFullClick(input);
    } else if (label) {
      dispatchFullClick(label);
    } else {
      dispatchFullClick(input);
    }

    if (input.checked === shouldCheck) {
      dispatchEvents(input);
      return {
        success: true,
        method: isVisible ? 'checkbox-input-click' : 'checkbox-label-click',
        appliedValue: shouldCheck ? 'Checked' : 'Unchecked',
      };
    }

    if (label) {
      dispatchFullClick(label);
    } else if (input.parentElement) {
      dispatchFullClick(input.parentElement);
    }

    if (input.checked === shouldCheck) {
      dispatchEvents(input);
      return {
        success: true,
        method: 'checkbox-retry-parent',
        appliedValue: shouldCheck ? 'Checked' : 'Unchecked',
      };
    }

    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
      if (setter) setter.call(input, shouldCheck);
      else input.checked = shouldCheck;
      dispatchEvents(input);
      return {
        success: input.checked === shouldCheck,
        method: 'checkbox-forced',
        appliedValue: shouldCheck ? 'Checked' : 'Unchecked',
      };
    } catch (err) {
      return { success: false, method: 'checkbox-failed', error: err.message };
    }
  }

  async function fillCheckboxGroup(fieldEntry, targetValues) {
    const options = fieldEntry.descriptor.options || [];
    if (options.length === 0) {
      return { success: false, error: 'Checkbox group has no options', method: 'checkbox-group-no-options' };
    }

    let targetList = [];
    if (Array.isArray(targetValues)) {
      targetList = targetValues.map(v => String(v).trim().toLowerCase());
    } else if (typeof targetValues === 'string') {
      targetList = targetValues.split(/[,;\n]+/).map(v => v.trim().toLowerCase()).filter(Boolean);
    } else if (targetValues) {
      targetList = [String(targetValues).trim().toLowerCase()];
    }

    const appliedNames = [];
    let anyFailure = false;

    for (const opt of options) {
      const cb = opt.element;
      if (!cb) continue;

      const optVal = String(opt.value || '').trim().toLowerCase();
      const optText = String(opt.text || '').trim().toLowerCase();
      const shouldBeChecked = targetList.some(t => {
        return (
          t === optVal ||
          t === optText ||
          (t.length > 2 && (optText.includes(t) || t.includes(optText)))
        );
      });

      if (cb.checked !== shouldBeChecked) {
        const label = opt.labelElement || findAssociatedLabelElement(cb);
        const isVisible = isElementVisible(cb);

        if (isVisible) {
          dispatchFullClick(cb);
        } else if (label) {
          dispatchFullClick(label);
        } else {
          dispatchFullClick(cb);
        }

        if (cb.checked !== shouldBeChecked && cb.parentElement) {
          dispatchFullClick(cb.parentElement);
        }

        if (cb.checked !== shouldBeChecked) {
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
            if (setter) setter.call(cb, shouldBeChecked);
            else cb.checked = shouldBeChecked;
          } catch (_) {}
        }

        dispatchEvents(cb);

        if (cb.checked !== shouldBeChecked) {
          anyFailure = true;
        }
      }

      if (cb.checked) {
        appliedNames.push(opt.text || opt.value);
      }

      await sleep(50);
    }

    return {
      success: !anyFailure,
      method: 'checkbox-group',
      appliedValue: appliedNames.join(', ') || 'None selected',
      error: anyFailure ? 'Some checkboxes could not be toggled' : null,
    };
  }

  async function fillCustomDropdown(fieldEntry, targetValue) {
    const trigger = fieldEntry.element;
    if (!trigger) return { success: false, error: 'Custom dropdown trigger missing', method: 'custom-dropdown-missing' };

    try {
      trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(100);
      dispatchFullClick(trigger);

      const options = await waitForPortalOptions(1500);

      const searchInput =
        trigger.querySelector('input') ||
        document.querySelector('[role="listbox"] input, .select__input input, .ant-select-dropdown input, .MuiAutocomplete-popper input');

      if (searchInput && !searchInput.readOnly && typeof targetValue === 'string') {
        setControlledInputValue(searchInput, targetValue.slice(0, 10));
        await sleep(150);
      }

      const allFoundOptions = options.length > 0 ? options : findAllAvailableDropdownOptions();
      if (allFoundOptions.length === 0) {
        closeDropdownWithEscape(trigger);
        return {
          success: false,
          method: 'custom-dropdown-no-options-appeared',
          error: 'No dropdown options appeared within 1.5s after clicking trigger',
        };
      }

      const matched = findBestOptionMatch(allFoundOptions, targetValue);
      if (!matched || !matched.element) {
        closeDropdownWithEscape(trigger);
        const availableSample = allFoundOptions.slice(0, 6).map(o => `"${o.text}"`).join(', ');
        return {
          success: false,
          method: 'custom-dropdown-nomatch',
          error: `Could not match "${targetValue}" among options: [${availableSample}]`,
        };
      }

      matched.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await sleep(50);
      dispatchFullClick(matched.element);
      dispatchEvents(trigger);

      return {
        success: true,
        method: 'custom-dropdown-portal-click',
        appliedValue: matched.text || String(targetValue),
      };
    } catch (err) {
      closeDropdownWithEscape(trigger);
      return { success: false, method: 'custom-dropdown-error', error: err.message };
    }
  }

  function fillStandardInput(element, targetValue) {
    if (!element) return { success: false, error: 'Element missing', method: 'standard-input-missing' };

    try {
      setControlledInputValue(element, String(targetValue));
      return {
        success: true,
        method: 'controlled-input',
        appliedValue: String(targetValue),
      };
    } catch (err) {
      return { success: false, method: 'controlled-input-error', error: err.message };
    }
  }

  function waitForPortalOptions(timeoutMs = 1500) {
    return new Promise(resolve => {
      const immediate = findAllAvailableDropdownOptions();
      if (immediate.length > 0) return resolve(immediate);

      let resolved = false;
      const observer = new MutationObserver(() => {
        const found = findAllAvailableDropdownOptions();
        if (found.length > 0 && !resolved) {
          resolved = true;
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(findAllAvailableDropdownOptions());
        }
      }, timeoutMs);
    });
  }

  function findAllAvailableDropdownOptions() {
    const selectors = [
      '[role="option"]',
      '[role="treeitem"]',
      '[role="menuitem"]',
      'li[class*="option"]',
      'li[class*="item"]',
      '.ant-select-item-option',
      '.MuiMenuItem-root',
      '.select__option',
      '[data-automation-id*="promptOption"]',
      '[class*="dropdown-menu"] li',
      '[class*="select-dropdown"] li',
    ];

    const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
    const visibleElements = elements.filter(el => isElementVisible(el));

    return visibleElements.map((el, index) => ({
      index,
      value: el.getAttribute('data-value') || el.getAttribute('value') || el.innerText.trim(),
      text: el.innerText.trim(),
      element: el,
    }));
  }

  function closeDropdownWithEscape(trigger) {
    try {
      const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
      trigger.dispatchEvent(new KeyboardEvent('keydown', opts));
      trigger.dispatchEvent(new KeyboardEvent('keyup', opts));
      document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
    } catch (_) {}
  }

  function dispatchFullClick(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 };
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + 5,
      clientY: rect.top + 5,
      button: 0,
    };

    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.dispatchEvent(new MouseEvent('click', eventInit));
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
  }

  function findBestOptionMatch(optionsList, targetVal) {
    if (!optionsList || targetVal === null || targetVal === undefined) return null;

    const options = Array.from(optionsList).map((opt, idx) => {
      const val = opt.value !== undefined ? String(opt.value) : '';
      const txt = opt.text !== undefined ? String(opt.text) : (opt.innerText || '');
      return {
        index: opt.index !== undefined ? opt.index : idx,
        value: val,
        text: txt,
        cleanVal: val.trim().toLowerCase(),
        cleanText: txt.trim().toLowerCase(),
        normVal: val.toLowerCase().replace(/[^a-z0-9]/g, ''),
        normText: txt.toLowerCase().replace(/[^a-z0-9]/g, ''),
        element: opt.element || opt,
        labelElement: opt.labelElement || null,
      };
    });

    const targetStr = String(targetVal).trim();
    const cleanTarget = targetStr.toLowerCase();
    const normTarget = cleanTarget.replace(/[^a-z0-9]/g, '');

    // 1. Exact match on cleanValue or cleanText
    for (const opt of options) {
      if (opt.cleanVal === cleanTarget || opt.cleanText === cleanTarget) {
        return opt;
      }
    }

    // 2. Normalized match (without punctuation/spaces)
    if (normTarget) {
      for (const opt of options) {
        if (opt.normVal === normTarget || opt.normText === normTarget) {
          return opt;
        }
      }
    }

    // 3. Abbreviation & Synonym Dictionary Lookup
    const matchedSynonym = matchAbbreviation(options, cleanTarget, normTarget);
    if (matchedSynonym) return matchedSynonym;

    // 4. Word Token / Substring Inclusion
    for (const opt of options) {
      if (opt.cleanText && cleanTarget) {
        if (opt.cleanText.includes(cleanTarget) || cleanTarget.includes(opt.cleanText)) {
          return opt;
        }
      }
    }

    // 5. Word token overlap ratio
    const targetWords = cleanTarget.split(/\s+/).filter(w => w.length > 2);
    if (targetWords.length > 0) {
      for (const opt of options) {
        const matchesCount = targetWords.filter(w => opt.cleanText.includes(w)).length;
        if (matchesCount >= Math.ceil(targetWords.length / 2)) {
          return opt;
        }
      }
    }

    return null;
  }

  const ABBREVIATION_GROUPS = [
    ['us', 'usa', 'united states', 'united states of america', 'u.s.', 'u.s.a.'],
    ['uk', 'united kingdom', 'great britain', 'gb', 'england'],
    ['ca', 'can', 'canada'],
    ['in', 'ind', 'india'],
    ['au', 'aus', 'australia'],
    ['de', 'deu', 'germany', 'deutschland'],
    ['fr', 'fra', 'france'],
    ['m', 'male', 'man', 'he/him'],
    ['f', 'female', 'woman', 'she/her'],
    ['nb', 'non-binary', 'nonbinary', 'genderqueer', 'they/them'],
    ['decline', 'prefer not to say', 'do not wish to specify', 'decline to state'],
    ['y', 'yes', 'true', '1', 'authorized', 'legally authorized', 'will relocate', 'agree', 'accept'],
    ['n', 'no', 'false', '0', 'unauthorized', 'requires sponsorship', 'will not relocate', 'decline', 'disagree'],
    ['ft', 'full-time', 'full time'],
    ['pt', 'part-time', 'part time'],
    ['remote', 'work from home', 'wfh', 'telecommute'],
    ['hybrid', 'flexible'],
    ['onsite', 'on-site', 'in-office'],
    ['al', 'alabama'], ['ak', 'alaska'], ['az', 'arizona'], ['ar', 'arkansas'], ['ca', 'california'],
    ['co', 'colorado'], ['ct', 'connecticut'], ['de', 'delaware'], ['fl', 'florida'], ['ga', 'georgia'],
    ['hi', 'hawaii'], ['id', 'idaho'], ['il', 'illinois'], ['in', 'indiana'], ['ia', 'iowa'],
    ['ks', 'kansas'], ['ky', 'kentucky'], ['la', 'louisiana'], ['me', 'maine'], ['md', 'maryland'],
    ['ma', 'massachusetts'], ['mi', 'michigan'], ['mn', 'minnesota'], ['ms', 'mississippi'], ['mo', 'missouri'],
    ['mt', 'montana'], ['ne', 'nebraska'], ['nv', 'nevada'], ['nh', 'new hampshire'], ['nj', 'new jersey'],
    ['nm', 'new mexico'], ['ny', 'new york'], ['nc', 'north carolina'], ['nd', 'north dakota'], ['oh', 'ohio'],
    ['ok', 'oklahoma'], ['or', 'oregon'], ['pa', 'pennsylvania'], ['ri', 'rhode island'], ['sc', 'south carolina'],
    ['sd', 'south dakota'], ['tn', 'tennessee'], ['tx', 'texas'], ['ut', 'utah'], ['vt', 'vermont'],
    ['va', 'virginia'], ['wa', 'washington'], ['wv', 'west virginia'], ['wi', 'wisconsin'], ['wy', 'wyoming'],
    ['dc', 'district of columbia']
  ];

  function matchAbbreviation(options, cleanTarget, normTarget) {
    for (const group of ABBREVIATION_GROUPS) {
      const targetMatchesGroup = group.some(alias => {
        const cleanAlias = alias.toLowerCase();
        return cleanAlias === cleanTarget || cleanAlias.replace(/[^a-z0-9]/g, '') === normTarget;
      });

      if (targetMatchesGroup) {
        for (const opt of options) {
          const optMatches = group.some(alias => {
            const cleanAlias = alias.toLowerCase();
            return (
              opt.cleanText === cleanAlias ||
              opt.cleanVal === cleanAlias ||
              opt.normText === cleanAlias.replace(/[^a-z0-9]/g, '') ||
              opt.normVal === cleanAlias.replace(/[^a-z0-9]/g, '')
            );
          });
          if (optMatches) return opt;
        }
      }
    }
    return null;
  }

  function findGroupQuestionLabel(firstRadio, container, groupName) {
    if (container) {
      const legend = container.querySelector('legend');
      if (legend && legend.innerText.trim()) return cleanLabelText(legend.innerText);

      const heading = container.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="label"]');
      if (heading && heading.innerText.trim()) return cleanLabelText(heading.innerText);

      const ariaLabel = container.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return cleanLabelText(ariaLabel);

      const labelledBy = container.getAttribute('aria-labelledby');
      if (labelledBy) {
        const refNode = document.getElementById(labelledBy);
        if (refNode && refNode.innerText.trim()) return cleanLabelText(refNode.innerText);
      }
    }

    if (groupName) {
      return cleanIdentifier(groupName.replace(/\[\]$/, ''));
    }

    return 'Multiple Choice Question';
  }

  function findOptionLabel(inputEl) {
    if (inputEl.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(inputEl.id)}"]`);
      if (explicit && explicit.innerText.trim()) return cleanLabelText(explicit.innerText);
    }

    const parentLabel = inputEl.closest('label');
    if (parentLabel && parentLabel.innerText.trim()) return cleanLabelText(parentLabel.innerText);

    const ariaLabel = inputEl.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return cleanLabelText(ariaLabel);

    const labelledby = inputEl.getAttribute('aria-labelledby');
    if (labelledby) {
      const refNode = document.getElementById(labelledby);
      if (refNode && refNode.innerText.trim()) return cleanLabelText(refNode.innerText);
    }

    let next = inputEl.nextElementSibling;
    while (next) {
      if (/span|div|label|p/i.test(next.tagName) && next.innerText.trim()) {
        return cleanLabelText(next.innerText);
      }
      next = next.nextElementSibling;
    }

    const nextNode = inputEl.nextSibling;
    if (nextNode && nextNode.nodeType === 3 && nextNode.textContent.trim()) {
      return cleanLabelText(nextNode.textContent);
    }

    return inputEl.value || 'Option';
  }

  function findAssociatedLabelElement(inputEl) {
    if (!inputEl) return null;
    if (inputEl.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(inputEl.id)}"]`);
      if (lbl) return lbl;
    }
    const parentLbl = inputEl.closest('label');
    if (parentLbl) return parentLbl;
    return null;
  }

  /**
   * Traverse DOM including Open Shadow Roots & Accessible Iframes
   */
  function collectAllCandidateElements(rootNode) {
    const results = [];
    const selector =
      'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="radiogroup"], [aria-haspopup="listbox"], [aria-haspopup="true"], .select__control, .ant-select-selector, .MuiSelect-select, [class*="react-select"], input[type="file"]';

    function walk(node) {
      if (!node) return;
      if (node.querySelectorAll) {
        const matches = node.querySelectorAll(selector);
        for (let i = 0; i < matches.length; i++) {
          results.push(matches[i]);
        }
      }

      if (node.shadowRoot) {
        walk(node.shadowRoot);
      }

      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      let curr = walker.currentNode;
      while (curr) {
        if (curr.shadowRoot) {
          walk(curr.shadowRoot);
        }
        curr = walker.nextNode();
      }
    }

    walk(rootNode);

    // Also check same-origin iframes
    const iframes = document.querySelectorAll('iframe');
    for (let f = 0; f < iframes.length; f++) {
      try {
        const iframeDoc = iframes[f].contentDocument || iframes[f].contentWindow?.document;
        if (iframeDoc) {
          const frameMatches = collectAllCandidateElements(iframeDoc);
          results.push(...frameMatches);
        }
      } catch (_) {}
    }

    return results;
  }

  function shouldIgnoreElement(el) {
    if (!el) return true;

    // File inputs should NEVER be ignored even if display:none, opacity:0, or off-screen!
    if (el.tagName.toLowerCase() === 'input' && el.type === 'file') {
      return el.disabled;
    }

    if (!el.getBoundingClientRect) return true;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' &&
      el.type !== 'radio' &&
      el.type !== 'checkbox' &&
      el.type !== 'file'
    ) {
      return true;
    }

    if (el.disabled || el.readOnly) return true;
    if (el.type === 'password' || el.type === 'hidden') return true;

    // Never fill credit cards or authentication secrets
    const sensitive = /password|credit-?card|cvv|cvc|card-?number|expiry|security-?code|otp|authenticator|token|ssn|social-?security/i;
    const identifier = `${el.name || ''} ${el.id || ''} ${el.autocomplete || ''} ${el.placeholder || ''}`;
    if (sensitive.test(identifier)) return true;

    // Ignore search bars
    if (el.type === 'search' || /search|query|nav-search/i.test(identifier)) {
      return true;
    }

    return false;
  }

  function buildFieldDescriptor(el, uniqueId) {
    const tagName = el.tagName.toLowerCase();
    let type = (el.type || tagName).toLowerCase();
    if (el.isContentEditable) type = 'textarea';

    const label = findSmartLabel(el);
    const required = el.required || el.getAttribute('aria-required') === 'true' || Boolean(el.closest('[required]'));
    const section = findSectionHeading(el);

    return {
      id: uniqueId,
      name: el.name || el.id || '',
      type,
      label,
      placeholder: el.placeholder || '',
      required,
      section,
      currentValue: getCurrentElementValue(el),
    };
  }

  function findSmartLabel(el) {
    if (el.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicit && explicit.innerText.trim()) return cleanLabelText(explicit.innerText);
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.innerText.trim()) return cleanLabelText(parentLabel.innerText);

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const refNode = document.getElementById(labelledby);
      if (refNode && refNode.innerText.trim()) return cleanLabelText(refNode.innerText);
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return cleanLabelText(ariaLabel);

    if (el.placeholder && el.placeholder.trim()) return cleanLabelText(el.placeholder);

    let prev = el.previousElementSibling;
    while (prev) {
      if (/label|span|div|p|h[1-6]/i.test(prev.tagName) && prev.innerText.trim()) {
        return cleanLabelText(prev.innerText);
      }
      prev = prev.previousElementSibling;
    }

    const container = el.closest('.form-group, .field, [class*="form-item"], [class*="form-row"], [class*="upload"], tr, td');
    if (container) {
      const groupLabel = container.querySelector('label, [class*="label"], [class*="title"], h3, h4');
      if (groupLabel && groupLabel !== el && groupLabel.innerText.trim()) {
        return cleanLabelText(groupLabel.innerText);
      }
    }

    const rawName = el.name || el.id || '';
    if (rawName) return cleanIdentifier(rawName);

    return 'Unknown Field';
  }

  function cleanLabelText(str) {
    return str
      .replace(/\s+/g, ' ')
      .replace(/[*:]+$/, '')
      .replace(/^\s*[*]+\s*/, '')
      .trim();
  }

  function cleanIdentifier(id) {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function findSectionHeading(el) {
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend && legend.innerText.trim()) return legend.innerText.trim();
    }
    const section = el.closest('section, [class*="section"], [class*="card"]');
    if (section) {
      const heading = section.querySelector('h1, h2, h3, h4');
      if (heading && heading.innerText.trim()) return heading.innerText.trim();
    }
    return '';
  }

  function getTopPageHeading() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.trim()) return h1.innerText.trim();
    const h2 = document.querySelector('h2');
    if (h2 && h2.innerText.trim()) return h2.innerText.trim();
    return '';
  }

  function normalizeLabelKey(label) {
    return String(label || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  function getCurrentElementValue(el) {
    if (!el) return '';
    if (el.type === 'file') return el.files && el.files[0] ? el.files[0].name : '';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    if (el.isContentEditable) return el.innerText || '';
    return el.value || el.innerText || '';
  }

  function setControlledInputValue(element, value) {
    if (!element) return false;
    const tag = element.tagName.toLowerCase();
    const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;

    try {
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(element, String(value));
      } else {
        element.value = String(value);
      }
    } catch (_) {
      element.value = String(value);
    }

    if (element.isContentEditable) {
      element.innerText = String(value);
    }

    dispatchEvents(element);
    return true;
  }

  function dispatchEvents(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  function applyHighlight(elements, level) {
    const list = Array.isArray(elements) ? elements : [elements];
    list.forEach(el => {
      if (!el || !el.classList) return;
      el.classList.remove('autofill-highlight-high', 'autofill-highlight-medium', 'autofill-highlight-unfilled');
      if (level === 'high') el.classList.add('autofill-highlight-high');
      else if (level === 'medium') el.classList.add('autofill-highlight-medium');
      else if (level === 'unfilled') el.classList.add('autofill-highlight-unfilled');
    });
  }

  /**
   * Render Floating Status Badge on Page
   * Shows "Resume attached", repeatable section warnings, or specific failure reasons
   */
  function renderFloatingBadge(filledCount, totalCount, failedCount = 0, filesAttachedCount = 0, fileUploadStatus = null, repeatableFailures = []) {
    if (floatingBadgeEl) {
      floatingBadgeEl.remove();
    }

    const badge = document.createElement('div');
    badge.id = 'autofill-ai-floating-badge';

    const failNotice = failedCount > 0
      ? `<span style="color:#f87171;font-weight:700;"> (${failedCount} failed)</span>`
      : '';

    let fileNotice = '';
    if (fileUploadStatus?.success) {
      fileNotice = ` • <span style="color:#34d399;font-weight:600;">📄 ${escapeHtml(fileUploadStatus.text || 'Resume attached')}</span>`;
    } else if (fileUploadStatus?.failed) {
      fileNotice = ` • <span style="color:#f87171;font-weight:600;" title="${escapeHtml(fileUploadStatus.error)}">⚠️ ${escapeHtml(fileUploadStatus.error.slice(0, 24))}</span>`;
    } else if (filesAttachedCount > 0) {
      fileNotice = ` • <span style="color:#34d399;font-weight:600;">📄 Resume attached</span>`;
    }

    let repeatNotice = '';
    if (repeatableFailures && repeatableFailures.length > 0) {
      repeatNotice = ` • <span style="color:#f87171;font-weight:600;">⚠️ ${repeatableFailures.length} section warning</span>`;
    }

    badge.innerHTML = `
      <div class="autofill-badge-logo">AI</div>
      <div class="autofill-badge-text">
        Filled <span class="autofill-badge-count">${filledCount}</span>/${totalCount} fields${fileNotice}${repeatNotice}${failNotice}
      </div>
      <button class="autofill-btn-review" id="autofill-trigger-review">Review</button>
      <button class="autofill-btn-undo" id="autofill-trigger-undo">Undo</button>
      <button class="autofill-btn-refill" id="autofill-trigger-refill" title="Fill dynamic or next step fields">Fill again</button>
      <button class="autofill-btn-close" id="autofill-trigger-close">✕</button>
    `;

    document.body.appendChild(badge);
    floatingBadgeEl = badge;

    badge.querySelector('#autofill-trigger-review').addEventListener('click', openReviewModal);
    badge.querySelector('#autofill-trigger-undo').addEventListener('click', performUndo);
    badge.querySelector('#autofill-trigger-refill').addEventListener('click', executeAutofillProcess);
    badge.querySelector('#autofill-trigger-close').addEventListener('click', () => {
      badge.remove();
      floatingBadgeEl = null;
    });
  }

  function performUndo() {
    if (undoHistory.length === 0) {
      showToast('No actions to undo.', 'info');
      return;
    }

    const lastSnapshot = undoHistory.pop();
    for (const item of lastSnapshot) {
      const entry = item.entry;
      if (!entry) continue;

      const elements = entry.elements || [entry.element];
      elements.forEach(el => {
        if (!el) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = item.previousValue;
        } else if (el.type === 'file') {
          el.value = '';
        } else {
          el.value = item.previousValue || '';
        }
        el.classList.remove('autofill-highlight-high', 'autofill-highlight-medium', 'autofill-highlight-unfilled');
        dispatchEvents(el);
      });
    }

    showToast('Autofill changes undone.', 'info');
    if (floatingBadgeEl) {
      floatingBadgeEl.remove();
      floatingBadgeEl = null;
    }
  }

  /**
   * Open Review & Correction Modal
   * Displays all fields including repeatable section failures and file uploads
   */
  function openReviewModal() {
    if (reviewModalEl) reviewModalEl.remove();

    const overlay = document.createElement('div');
    overlay.id = 'autofill-ai-review-modal-overlay';

    const fieldsList = Array.from(activeFieldMap.values());

    overlay.innerHTML = `
      <div id="autofill-ai-review-modal">
        <div class="autofill-modal-header">
          <div class="autofill-modal-title">
            <span>✨ AutoFill AI — Review & Corrections</span>
          </div>
          <button class="autofill-btn-close" id="autofill-modal-close-x" style="all:unset;cursor:pointer;color:#94a3b8;font-size:18px;">✕</button>
        </div>
        <div class="autofill-modal-body">
          <p style="font-size:13px;color:#94a3b8;margin:0 0 10px 0;">
            Review or correct any values below. Upload fields feature an <strong>Attach again</strong> button. Clicking <strong>Save & Learn</strong> updates the page and memorizes your corrections!
          </p>

          ${activeRepeatableFailures.length > 0 ? `
            <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;">
              ${activeRepeatableFailures.map(rf => `
                <div class="autofill-field-row has-failure" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.4);">
                  <div class="autofill-field-header">
                    <span class="autofill-field-label">🔁 ${escapeHtml(rf.section)}</span>
                    <span class="autofill-field-badge autofill-badge-failed">⚠️ Repeatable Section</span>
                  </div>
                  <div class="autofill-failure-message">⚠️ ${escapeHtml(rf.message)}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${fieldsList.map((item) => {
            const isFile = item.descriptor.type === 'file';
            const isFailed = item.status === 'failed';
            const conf = item.confidence || 0;
            let badgeClass = 'autofill-badge-none';
            let badgeText = isFile ? 'Unattached' : 'Unfilled';

            if (isFailed) {
              badgeClass = 'autofill-badge-failed';
              badgeText = '⚠️ Failed';
            } else if (isFile && item.status === 'success') {
              badgeClass = 'autofill-badge-high';
              badgeText = '📄 Attached';
            } else if (conf >= 0.75) {
              badgeClass = 'autofill-badge-high';
              badgeText = `${Math.round(conf * 100)}% match`;
            } else if (conf > 0) {
              badgeClass = 'autofill-badge-med';
              badgeText = `${Math.round(conf * 100)}% inferred`;
            }

            const val = item.filledValue !== null && item.filledValue !== undefined ? item.filledValue : '';

            return `
              <div class="autofill-field-row ${isFailed ? 'has-failure' : ''}" data-field-id="${item.descriptor.id}">
                <div class="autofill-field-header">
                  <span class="autofill-field-label">
                    ${isFile ? '📎 ' : ''}${escapeHtml(item.descriptor.label || item.descriptor.name)}
                  </span>
                  <span class="autofill-field-badge ${badgeClass}">${badgeText}</span>
                </div>
                ${isFailed && item.errorMessage ? `<div class="autofill-failure-message">⚠️ ${escapeHtml(item.errorMessage)}</div>` : ''}

                ${isFile ? `
                  <div class="autofill-file-row-actions">
                    <span style="font-size:12px;color:#e2e8f0;font-weight:600;">
                      ${item.attachedFileName ? `📄 ${escapeHtml(item.attachedFileName)}` : (item.errorMessage ? 'Not attached' : 'No file attached')}
                    </span>
                    <button class="autofill-btn-attach" data-field-id="${item.descriptor.id}">
                      ${(item.attachedFileName || (item.element && item.element.files && item.element.files.length > 0)) ? '⚡ Overwrite' : '⚡ Attach again'}
                    </button>
                  </div>
                ` : `
                  <input class="autofill-field-input" value="${escapeHtml(String(val))}" placeholder="Enter or correct value..." />
                `}

                <div class="autofill-field-reason">
                  ${item.methodUsed ? `<span>Method: <code>${escapeHtml(item.methodUsed)}</code></span> • ` : ''}
                  ${escapeHtml(item.reason || '')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="autofill-modal-footer">
          <button class="autofill-btn-secondary" id="autofill-modal-cancel">Close</button>
          <button class="autofill-btn-primary" id="autofill-modal-save">Save & Learn Corrections</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    reviewModalEl = overlay;

    overlay.querySelector('#autofill-modal-close-x').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#autofill-modal-cancel').addEventListener('click', () => overlay.remove());

    // Attach listeners for manual "Attach again" buttons on file upload fields
    overlay.querySelectorAll('.autofill-btn-attach').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fieldId = btn.getAttribute('data-field-id');
        const fieldItem = activeFieldMap.get(fieldId);
        if (!fieldItem) return;

        btn.disabled = true;
        btn.textContent = 'Attaching...';

        const attachRes = await handleFileUploadField(fieldItem, fieldItem.reason || 'resume', true);
        if (attachRes.success) {
          fieldItem.status = 'success';
          fieldItem.attachedFileName = attachRes.fileName;
          fieldItem.filledValue = attachRes.fileName;
          applyHighlight(fieldItem.elements, 'high');
          btn.textContent = '✓ Attached!';
          showToast(`Attached ${attachRes.fileName} successfully!`, 'success');
        } else {
          fieldItem.status = 'failed';
          fieldItem.errorMessage = attachRes.error || attachRes.reason;
          btn.textContent = '⚠️ Retry';
          showToast(`Failed: ${fieldItem.errorMessage}`, 'error');
        }

        setTimeout(() => {
          btn.disabled = false;
        }, 1000);
      });
    });

    // Save & Learn Corrections handler
    overlay.querySelector('#autofill-modal-save').addEventListener('click', async () => {
      const rows = overlay.querySelectorAll('.autofill-field-row');
      let updatedCount = 0;

      for (const row of rows) {
        const id = row.getAttribute('data-field-id');
        const input = row.querySelector('.autofill-field-input');
        if (!input) continue;

        const newVal = input.value.trim();
        const fieldItem = activeFieldMap.get(id);

        if (fieldItem && newVal !== String(fieldItem.filledValue || '').trim()) {
          await fillFieldWithStrategy(fieldItem, newVal);
          fieldItem.filledValue = newVal;
          fieldItem.status = 'success';
          applyHighlight(fieldItem.elements, 'high');
          updatedCount++;

          const qKey = normalizeLabelKey(fieldItem.descriptor.label || fieldItem.descriptor.name);
          chrome.runtime.sendMessage({
            action: 'ACTION_SAVE_LEARNED_ANSWER',
            questionKey: qKey,
            answer: newVal,
            reason: `Manually corrected for "${fieldItem.descriptor.label}"`,
          });
        }
      }

      overlay.remove();
      showToast(`Updated and memorized ${updatedCount} answers!`, 'success');
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let stepObserver = null;
  function setupStepObserver() {
    if (stepObserver) return;

    let debounceTimer = null;
    stepObserver = new MutationObserver(mutations => {
      let hasSignificantAdditions = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (
              node.nodeType === 1 &&
              (node.matches('input, select, textarea, [role="combobox"], [class*="upload"], [class*="dropzone"]') ||
                node.querySelector?.('input, select, textarea, [role="combobox"], [class*="upload"]'))
            ) {
              hasSignificantAdditions = true;
              break;
            }
          }
        }
      }

      if (hasSignificantAdditions) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (floatingBadgeEl) {
            const refillBtn = floatingBadgeEl.querySelector('#autofill-trigger-refill');
            if (refillBtn) {
              refillBtn.style.animation = 'pulse 1s infinite';
              refillBtn.innerText = 'New fields detected! Fill';
            }
          }
        }, 500);
      }
    });

    stepObserver.observe(document.body, { childList: true, subtree: true });
  }

  function showToast(message, type = 'info') {
    const existing = document.getElementById('autofill-ai-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'autofill-ai-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      padding: 10px 18px;
      background: ${type === 'error' ? '#dc2626' : type === 'warn' ? '#d97706' : type === 'success' ? '#059669' : '#1f2937'};
      color: #ffffff;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
      transition: opacity 0.3s ease;
      pointer-events: none;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
})();
