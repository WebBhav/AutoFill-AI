/**
 * AutoFill AI - Options Page Script
 * Multi-document management (Resume, Cover Letter, ID Proof),
 * local file storage (base64 + size + mime type), auto-attach settings,
 * and LLM-powered PROFILE.md generation.
 */

import { getStorageData, setStorageData, STORAGE_KEYS } from '../utils.js';

const BLANK_PROFILE_TEMPLATE = `# PERSONAL PROFILE

## 1. Personal & Contact Information
- Full Name: John Doe
- First Name: John
- Middle Name: 
- Last Name: Doe
- Preferred / Nickname: John
- Email: john.doe@example.com
- Phone (Primary): +1 (555) 234-5678
- Phone (Mobile): +1 (555) 234-5678
- Street Address: 123 Tech Boulevard
- Apartment / Suite: Apt 4B
- City: San Francisco
- State / Province: CA
- Postal Code: 94105
- Country: United States

## 2. Web & Social Links
- LinkedIn: https://linkedin.com/in/johndoe
- GitHub: https://github.com/johndoe
- Personal Portfolio / Website: https://johndoe.dev
- Twitter / X: https://x.com/johndoe
- Other Links: 

## 3. Work Authorization & Logistics
- Legally Authorized to Work in Country of Residence: Yes
- Will now or in the future require visa sponsorship: No
- Current Work Authorization / Visa Type: US Citizen
- Willing to Relocate: Yes
- Notice Period / Available Start Date: 2 weeks
- Desired Salary / Rate: $150,000 / year
- Current Location: San Francisco, CA

## 4. Professional Summary & Headlines
- Professional Title / Headline: Senior Full-Stack Software Engineer
- Short Summary: Full-stack engineer with 6+ years of experience specializing in React, TypeScript, Node.js, and cloud systems. Passionate about performant user interfaces and developer tooling.
- Years of Professional Experience: 6

## 5. Work Experience
- **Senior Software Engineer** | Acme Cloud Inc. (2022 - Present) | San Francisco, CA
  - Architected high-throughput microservices handling 20M+ daily events using Node.js and Redis.
  - Led frontend revamp to React 19, improving Lighthouse performance score by 35%.
- **Software Engineer** | Beta Corp (2019 - 2022) | Austin, TX
  - Developed customer dashboard used by 50,000+ monthly active users.
  - Implemented CI/CD pipelines with GitHub Actions reducing deploy times by 50%.

## 6. Education
- **Bachelor of Science in Computer Science** | University of California, Berkeley (2015 - 2019) | GPA: 3.8

## 7. Skills & Competencies
- Programming Languages: JavaScript, TypeScript, Python, Go, HTML5, CSS3
- Frameworks & Libraries: React, Next.js, Node.js, Express, Tailwind CSS
- Databases & Cloud: PostgreSQL, MongoDB, Redis, AWS (S3, Lambda, ECS), Docker
- Tools & Software: Git, Linux, Figma, Postman, Jest, Vite
- Soft Skills: Technical Leadership, Cross-functional Communication, Mentorship

## 8. Certifications & Licenses
- AWS Certified Solutions Architect - Associate (2023)

## 9. Languages
- English (Native / Bilingual)
- Spanish (Intermediate)

## 10. Common Job Application Q&A
- Why are you interested in this role?: Looking to build impactful software products and collaborate with high-velocity engineering teams.
- Greatest professional accomplishment: Led architectural redesign that scaled platform from 10k to 500k concurrent users with zero downtime.
- Preferred work arrangement: Hybrid or Remote
- Has driver's license: Yes
- Veteran status: Not a veteran
- Disability status: No disability
`;

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation elements
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Settings tab elements
  const providerSelect = document.getElementById('provider-select');
  const groupGemini = document.getElementById('group-gemini');
  const groupOpenai = document.getElementById('group-openai');
  const groupAnthropic = document.getElementById('group-anthropic');
  const modelGemini = document.getElementById('model-gemini');
  const groupCustomGemini = document.getElementById('group-custom-gemini');
  const customGeminiInput = document.getElementById('custom-gemini-input');
  const modelOpenai = document.getElementById('model-openai');
  const modelAnthropic = document.getElementById('model-anthropic');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnTestKey = document.getElementById('btn-test-key');

  // Resume upload & file manager elements
  const settingAutoAttach = document.getElementById('setting-auto-attach-resume');
  const settingAutoClickAdd = document.getElementById('setting-auto-click-add');
  const dropZone = document.getElementById('drop-zone');
  const pdfFilePicker = document.getElementById('pdf-file-picker');
  const replaceFilePicker = document.getElementById('replace-file-picker');
  const uploadStatus = document.getElementById('upload-status');
  const uploadStatusText = document.getElementById('upload-status-text');
  const storedDocsCount = document.getElementById('stored-docs-count');
  const storedDocsEmpty = document.getElementById('stored-docs-empty');
  const storedDocsList = document.getElementById('stored-docs-list');
  const btnExtractAllProfile = document.getElementById('btn-extract-all-profile');

  // Profile Editor elements
  const profileEditor = document.getElementById('profile-markdown-editor');
  const profileCharCount = document.getElementById('profile-char-count');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const btnLoadTemplate = document.getElementById('btn-load-template');

  // Learned answers elements
  const learnedEmptyState = document.getElementById('learned-empty-state');
  const learnedTableWrapper = document.getElementById('learned-table-wrapper');
  const learnedTableBody = document.getElementById('learned-table-body');

  // Delete modal elements
  const btnDeleteAll = document.getElementById('btn-delete-all');
  const confirmModal = document.getElementById('confirm-modal');
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  // In-memory active file replacement target ID
  let activeReplaceFileId = null;

  // Tab navigation
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-target');
      navItems.forEach(n => n.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(target)?.classList.add('active');
    });
  });

  // Toggle API key visibility
  btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Provider change handler
  providerSelect.addEventListener('change', () => {
    const val = providerSelect.value;
    groupGemini.classList.toggle('hidden', val !== 'gemini');
    groupOpenai.classList.toggle('hidden', val !== 'openai');
    groupAnthropic.classList.toggle('hidden', val !== 'anthropic');
  });

  // Gemini model dropdown change handler (show custom input if 'custom')
  modelGemini.addEventListener('change', () => {
    groupCustomGemini.classList.toggle('hidden', modelGemini.value !== 'custom');
    if (modelGemini.value === 'custom') {
      customGeminiInput.focus();
    }
  });

  // Auto-attach setting toggle handler
  settingAutoAttach.addEventListener('change', async () => {
    const enabled = settingAutoAttach.checked;
    await setStorageData({ [STORAGE_KEYS.AUTO_ATTACH_RESUME]: enabled });
    showToast(enabled ? 'Resume auto-attach enabled!' : 'Resume auto-attach disabled', 'info');
  });

  // Auto-click add buttons toggle handler
  if (settingAutoClickAdd) {
    settingAutoClickAdd.addEventListener('change', async () => {
      const enabled = settingAutoClickAdd.checked;
      await setStorageData({ [STORAGE_KEYS.AUTO_CLICK_ADD_BUTTONS]: enabled });
      showToast(enabled ? 'Auto-click "+ Add" buttons enabled!' : 'Auto-click "+ Add" buttons disabled', 'info');
    });
  }

  // Load existing storage data
  await loadAllStoredData();

  // Save Provider Settings
  btnSaveSettings.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    let gModel = modelGemini.value;
    if (gModel === 'custom') {
      gModel = customGeminiInput.value.trim() || 'gemini-3.8-flash';
    }
    const oModel = modelOpenai.value;
    const aModel = modelAnthropic.value;

    await setStorageData({
      [STORAGE_KEYS.PROVIDER]: provider,
      [STORAGE_KEYS.API_KEY]: apiKey,
      [STORAGE_KEYS.GEMINI_MODEL]: gModel,
      [STORAGE_KEYS.OPENAI_MODEL]: oModel,
      [STORAGE_KEYS.ANTHROPIC_MODEL]: aModel,
    });

    showToast('Settings saved successfully!', 'success');
  });

  // Test Connection
  btnTestKey.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const provider = providerSelect.value;
    if (!apiKey) {
      showToast('Please enter an API Key first.', 'error');
      return;
    }

    btnTestKey.disabled = true;
    btnTestKey.textContent = 'Testing...';

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'ACTION_GENERATE_PROFILE',
        text: 'Candidate: Test User, Full-Stack Engineer, Location: Test City',
        existingProfile: '',
      });

      if (resp && resp.success) {
        showToast('Connection verified! API key works.', 'success');
      } else {
        showToast(`API error: ${resp?.error || 'Unknown failure'}`, 'error');
      }
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'error');
    } finally {
      btnTestKey.disabled = false;
      btnTestKey.textContent = 'Test Connection';
    }
  });

  // Drag and drop for PDF
  dropZone.addEventListener('click', () => pdfFilePicker.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await processUploadedFiles(files);
    }
  });

  pdfFilePicker.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processUploadedFiles(files);
      pdfFilePicker.value = ''; // Reset for re-selection
    }
  });

  // Replace file picker handler
  replaceFilePicker.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file && activeReplaceFileId) {
      await replaceStoredFile(activeReplaceFileId, file);
      replaceFilePicker.value = '';
      activeReplaceFileId = null;
    }
  });

  /**
   * Process newly uploaded files: store in chrome.storage.local (base64, size, mime, name)
   * and analyze with LLM to merge with PROFILE.md
   */
  async function processUploadedFiles(files) {
    const validFiles = Array.from(files).filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || name.endsWith('.doc') || name.endsWith('.docx') || f.type.includes('pdf');
    });

    if (validFiles.length === 0) {
      showToast('Please select valid document files (.pdf, .doc, .docx).', 'error');
      return;
    }

    // Warn if file exceeds 20 MB
    const MAX_SIZE = 20 * 1024 * 1024;
    for (const file of validFiles) {
      if (file.size > MAX_SIZE) {
        showToast(`Warning: "${file.name}" is larger than 20 MB. It may exceed AI document limits.`, 'warn');
      }
    }

    uploadStatus.classList.remove('hidden');
    uploadStatusText.textContent = `Reading ${validFiles.length} file(s)...`;

    try {
      const storage = await getStorageData([STORAGE_KEYS.STORED_FILES, STORAGE_KEYS.API_KEY]);
      let storedFiles = storage[STORAGE_KEYS.STORED_FILES] || [];

      const payloadForLLM = [];

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const base64 = await fileToBase64(file);
        const label = detectInitialFileLabel(file.name);

        const newDoc = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.size,
          base64,
          label,
          isDefault: storedFiles.length === 0 && label === 'resume',
          updatedAt: new Date().toISOString(),
        };

        // If no default exists yet, make first resume default
        if (!storedFiles.some(d => d.isDefault) && label === 'resume') {
          newDoc.isDefault = true;
        }

        storedFiles.push(newDoc);

        if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
          payloadForLLM.push({
            name: file.name,
            type: file.type || 'application/pdf',
            base64,
          });
        }
      }

      // Sync primary default resume for backward compatibility
      const defaultResume = storedFiles.find(d => d.isDefault) || storedFiles.find(d => d.label === 'resume') || storedFiles[0];

      await setStorageData({
        [STORAGE_KEYS.STORED_FILES]: storedFiles,
        [STORAGE_KEYS.RESUME_FILE]: defaultResume ? {
          name: defaultResume.name,
          type: defaultResume.type,
          base64: defaultResume.base64,
          size: defaultResume.size,
          updatedAt: defaultResume.updatedAt,
        } : null,
      });

      renderStoredDocumentsList(storedFiles);
      showToast(`Saved ${validFiles.length} document(s) to local storage.`, 'success');

      // If LLM API Key is configured, trigger automatic extraction & merge
      if (storage[STORAGE_KEYS.API_KEY] && payloadForLLM.length > 0) {
        uploadStatusText.textContent = '✨ Extracting information & updating PROFILE.md...';
        const currentProfile = profileEditor.value.trim();
        const resp = await chrome.runtime.sendMessage({
          action: 'ACTION_EXTRACT_AND_MERGE_PDF',
          files: payloadForLLM,
          existingProfile: currentProfile,
        });

        if (resp && resp.success) {
          profileEditor.value = resp.profileMd;
          updateCharCount();
          showToast('Updated PROFILE.md with document data!', 'success');
        }
      }
    } catch (err) {
      console.error(err);
      showToast(`Upload error: ${err.message}`, 'error');
    } finally {
      uploadStatus.classList.add('hidden');
    }
  }

  /**
   * Replace contents of an existing stored file while keeping label or default status
   */
  async function replaceStoredFile(docId, newFile) {
    uploadStatus.classList.remove('hidden');
    uploadStatusText.textContent = `Replacing with ${newFile.name}...`;

    try {
      const base64 = await fileToBase64(newFile);
      const storage = await getStorageData([STORAGE_KEYS.STORED_FILES]);
      let storedFiles = storage[STORAGE_KEYS.STORED_FILES] || [];

      const docIndex = storedFiles.findIndex(d => d.id === docId);
      if (docIndex !== -1) {
        storedFiles[docIndex].name = newFile.name;
        storedFiles[docIndex].type = newFile.type || 'application/pdf';
        storedFiles[docIndex].size = newFile.size;
        storedFiles[docIndex].base64 = base64;
        storedFiles[docIndex].updatedAt = new Date().toISOString();

        // Sync primary resume if replaced doc is default
        const defaultResume = storedFiles.find(d => d.isDefault) || storedFiles[0];

        await setStorageData({
          [STORAGE_KEYS.STORED_FILES]: storedFiles,
          [STORAGE_KEYS.RESUME_FILE]: defaultResume ? {
            name: defaultResume.name,
            type: defaultResume.type,
            base64: defaultResume.base64,
            size: defaultResume.size,
            updatedAt: defaultResume.updatedAt,
          } : null,
        });

        renderStoredDocumentsList(storedFiles);
        showToast(`Replaced document with ${newFile.name}!`, 'success');
      }
    } catch (err) {
      showToast(`Replace failed: ${err.message}`, 'error');
    } finally {
      uploadStatus.classList.add('hidden');
    }
  }

  /**
   * Re-extract all stored PDF documents into PROFILE.md
   */
  btnExtractAllProfile.addEventListener('click', async () => {
    const storage = await getStorageData([STORAGE_KEYS.STORED_FILES, STORAGE_KEYS.API_KEY]);
    const storedFiles = storage[STORAGE_KEYS.STORED_FILES] || [];

    if (storedFiles.length === 0) {
      showToast('No stored documents found. Upload a resume first.', 'warn');
      return;
    }
    if (!storage[STORAGE_KEYS.API_KEY]) {
      showToast('Please set your LLM API Key in the "LLM & API Key" tab first.', 'error');
      document.querySelector('[data-target="section-api"]')?.click();
      return;
    }

    uploadStatus.classList.remove('hidden');
    uploadStatusText.textContent = `Analyzing ${storedFiles.length} stored document(s) with AI...`;

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'ACTION_EXTRACT_AND_MERGE_PDF',
        files: storedFiles.map(d => ({
          name: d.name,
          type: d.type,
          base64: d.base64,
        })),
        existingProfile: profileEditor.value.trim(),
      });

      if (resp && resp.success) {
        profileEditor.value = resp.profileMd;
        updateCharCount();
        showToast('Successfully updated PROFILE.md from documents!', 'success');
        document.querySelector('[data-target="section-profile"]')?.click();
      } else {
        showToast(`Extraction failed: ${resp?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      uploadStatus.classList.add('hidden');
    }
  });

  /**
   * Render the stored documents list
   */
  function renderStoredDocumentsList(docs) {
    storedDocsCount.textContent = docs.length;

    if (!docs || docs.length === 0) {
      storedDocsEmpty.classList.remove('hidden');
      storedDocsList.classList.add('hidden');
      storedDocsList.innerHTML = '';
      return;
    }

    storedDocsEmpty.classList.add('hidden');
    storedDocsList.classList.remove('hidden');
    storedDocsList.innerHTML = '';

    docs.forEach(doc => {
      const card = document.createElement('div');
      card.className = `doc-item-card ${doc.isDefault ? 'is-default' : ''}`;

      const formattedSize = doc.size ? formatBytes(doc.size) : 'Unknown size';
      const fileExt = doc.name.split('.').pop()?.toUpperCase() || 'PDF';

      card.innerHTML = `
        <div class="doc-item-left">
          <span class="doc-file-icon">${fileExt === 'PDF' ? '📄' : '📑'}</span>
          <div class="doc-details">
            <div class="doc-title-row">
              <span class="doc-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
              ${doc.isDefault ? '<span class="doc-badge-default">⭐ Default Resume</span>' : ''}
            </div>
            <span class="doc-meta">
              ${formattedSize} • ${escapeHtml(doc.type || 'application/pdf')} • ${new Date(doc.updatedAt || Date.now()).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div class="doc-item-right">
          <select class="doc-label-select" data-id="${doc.id}">
            <option value="resume" ${doc.label === 'resume' ? 'selected' : ''}>Resume / CV</option>
            <option value="cover_letter" ${doc.label === 'cover_letter' ? 'selected' : ''}>Cover Letter</option>
            <option value="other_document" ${doc.label === 'other_document' ? 'selected' : ''}>Other Document</option>
            <option value="id_proof" ${doc.label === 'id_proof' ? 'selected' : ''}>ID Proof</option>
          </select>

          ${!doc.isDefault && doc.label === 'resume' ? `
            <button class="doc-action-btn btn-make-default" data-id="${doc.id}" title="Set as default resume for autofill">
              Set Default
            </button>
          ` : ''}

          <button class="doc-action-btn btn-replace" data-id="${doc.id}" title="Replace this file with an updated version">
            Replace
          </button>

          <button class="doc-action-btn btn-remove" data-id="${doc.id}" title="Remove file">
            Remove
          </button>
        </div>
      `;

      storedDocsList.appendChild(card);
    });

    // Attach listeners for label change
    storedDocsList.querySelectorAll('.doc-label-select').forEach(select => {
      select.addEventListener('change', async () => {
        const id = select.getAttribute('data-id');
        const newLabel = select.value;
        const storage = await getStorageData([STORAGE_KEYS.STORED_FILES]);
        const list = storage[STORAGE_KEYS.STORED_FILES] || [];
        const item = list.find(d => d.id === id);
        if (item) {
          item.label = newLabel;
          // If label changed away from resume and it was default, clear default
          if (newLabel !== 'resume' && item.isDefault) {
            item.isDefault = false;
            const nextResume = list.find(d => d.label === 'resume');
            if (nextResume) nextResume.isDefault = true;
          }
          await setStorageData({ [STORAGE_KEYS.STORED_FILES]: list });
          renderStoredDocumentsList(list);
          showToast(`Updated document label to "${select.options[select.selectedIndex].text}"`, 'info');
        }
      });
    });

    // Attach listeners for make default
    storedDocsList.querySelectorAll('.btn-make-default').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const storage = await getStorageData([STORAGE_KEYS.STORED_FILES]);
        const list = storage[STORAGE_KEYS.STORED_FILES] || [];
        list.forEach(d => {
          d.isDefault = d.id === id;
        });
        const defaultDoc = list.find(d => d.id === id);
        await setStorageData({
          [STORAGE_KEYS.STORED_FILES]: list,
          [STORAGE_KEYS.RESUME_FILE]: defaultDoc ? {
            name: defaultDoc.name,
            type: defaultDoc.type,
            base64: defaultDoc.base64,
            size: defaultDoc.size,
            updatedAt: defaultDoc.updatedAt,
          } : null,
        });
        renderStoredDocumentsList(list);
        showToast(`Set "${defaultDoc?.name}" as primary default resume!`, 'success');
      });
    });

    // Attach listeners for replace
    storedDocsList.querySelectorAll('.btn-replace').forEach(btn => {
      btn.addEventListener('click', () => {
        activeReplaceFileId = btn.getAttribute('data-id');
        replaceFilePicker.click();
      });
    });

    // Attach listeners for remove
    storedDocsList.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const storage = await getStorageData([STORAGE_KEYS.STORED_FILES]);
        let list = storage[STORAGE_KEYS.STORED_FILES] || [];
        const removed = list.find(d => d.id === id);
        list = list.filter(d => d.id !== id);

        // If removed file was default, promote next available resume
        if (removed?.isDefault && list.length > 0) {
          const nextResume = list.find(d => d.label === 'resume') || list[0];
          nextResume.isDefault = true;
        }

        const defaultDoc = list.find(d => d.isDefault) || list[0] || null;

        await setStorageData({
          [STORAGE_KEYS.STORED_FILES]: list,
          [STORAGE_KEYS.RESUME_FILE]: defaultDoc ? {
            name: defaultDoc.name,
            type: defaultDoc.type,
            base64: defaultDoc.base64,
            size: defaultDoc.size,
            updatedAt: defaultDoc.updatedAt,
          } : null,
        });

        renderStoredDocumentsList(list);
        showToast(`Removed "${removed?.name}"`, 'info');
      });
    });
  }

  // Profile Editor actions
  profileEditor.addEventListener('input', updateCharCount);

  function updateCharCount() {
    const len = profileEditor.value.length;
    profileCharCount.textContent = `${len.toLocaleString()} characters`;
  }

  btnSaveProfile.addEventListener('click', async () => {
    const content = profileEditor.value.trim();
    await setStorageData({ [STORAGE_KEYS.PROFILE_MD]: content });
    showToast('PROFILE.md saved!', 'success');
  });

  btnLoadTemplate.addEventListener('click', () => {
    if (profileEditor.value.trim().length > 50) {
      if (!confirm('Replace your current profile with the sample template? You can always undo or edit.')) {
        return;
      }
    }
    profileEditor.value = BLANK_PROFILE_TEMPLATE;
    updateCharCount();
    showToast('Loaded profile template. Fill in your details and click Save!', 'info');
  });

  // Delete All Data Modal Handlers
  btnDeleteAll.addEventListener('click', () => {
    confirmModal.classList.remove('hidden');
  });

  btnCancelDelete.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  btnConfirmDelete.addEventListener('click', async () => {
    confirmModal.classList.add('hidden');
    await chrome.runtime.sendMessage({ action: 'ACTION_CLEAR_ALL_DATA' });
    showToast('All stored data erased.', 'info');
    await loadAllStoredData();
  });

  // Initial load helper
  async function loadAllStoredData() {
    const data = await getStorageData([
      STORAGE_KEYS.PROVIDER,
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.GEMINI_MODEL,
      STORAGE_KEYS.OPENAI_MODEL,
      STORAGE_KEYS.ANTHROPIC_MODEL,
      STORAGE_KEYS.PROFILE_MD,
      STORAGE_KEYS.RESUME_FILE,
      STORAGE_KEYS.STORED_FILES,
      STORAGE_KEYS.AUTO_ATTACH_RESUME,
      STORAGE_KEYS.AUTO_CLICK_ADD_BUTTONS,
      STORAGE_KEYS.LEARNED_ANSWERS,
    ]);

    // Provider & models
    const prov = data[STORAGE_KEYS.PROVIDER] || 'gemini';
    providerSelect.value = prov;
    groupGemini.classList.toggle('hidden', prov !== 'gemini');
    groupOpenai.classList.toggle('hidden', prov !== 'openai');
    groupAnthropic.classList.toggle('hidden', prov !== 'anthropic');

    if (data[STORAGE_KEYS.API_KEY]) apiKeyInput.value = data[STORAGE_KEYS.API_KEY];

    const savedGeminiModel = data[STORAGE_KEYS.GEMINI_MODEL] || 'gemini-3.8-flash';
    const standardGeminiOptions = ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'];
    if (standardGeminiOptions.includes(savedGeminiModel)) {
      modelGemini.value = savedGeminiModel;
      groupCustomGemini.classList.add('hidden');
    } else {
      modelGemini.value = 'custom';
      groupCustomGemini.classList.remove('hidden');
      customGeminiInput.value = savedGeminiModel;
    }

    if (data[STORAGE_KEYS.OPENAI_MODEL]) modelOpenai.value = data[STORAGE_KEYS.OPENAI_MODEL];
    if (data[STORAGE_KEYS.ANTHROPIC_MODEL]) modelAnthropic.value = data[STORAGE_KEYS.ANTHROPIC_MODEL];

    // Auto attach setting (default true)
    settingAutoAttach.checked = data[STORAGE_KEYS.AUTO_ATTACH_RESUME] !== false;

    // Auto click add buttons setting (default true)
    if (settingAutoClickAdd) {
      settingAutoClickAdd.checked = data[STORAGE_KEYS.AUTO_CLICK_ADD_BUTTONS] !== false;
    }

    // Stored documents
    let storedDocs = data[STORAGE_KEYS.STORED_FILES] || [];

    // Migration: if no storedDocs but older RESUME_FILE exists
    if (storedDocs.length === 0 && data[STORAGE_KEYS.RESUME_FILE]) {
      const old = data[STORAGE_KEYS.RESUME_FILE];
      storedDocs = [{
        id: `doc_${Date.now()}`,
        name: old.name || 'Resume.pdf',
        type: old.type || 'application/pdf',
        size: old.size || (old.base64 ? Math.round(old.base64.length * 0.75) : 100000),
        base64: old.base64,
        label: 'resume',
        isDefault: true,
        updatedAt: old.updatedAt || new Date().toISOString(),
      }];
      await setStorageData({ [STORAGE_KEYS.STORED_FILES]: storedDocs });
    }

    renderStoredDocumentsList(storedDocs);

    // Profile MD
    profileEditor.value = data[STORAGE_KEYS.PROFILE_MD] || '';
    updateCharCount();

    // Learned Answers table
    renderLearnedAnswersTable(data[STORAGE_KEYS.LEARNED_ANSWERS] || {});
  }

  function renderLearnedAnswersTable(learned) {
    const keys = Object.keys(learned);
    if (keys.length === 0) {
      learnedEmptyState.classList.remove('hidden');
      learnedTableWrapper.classList.add('hidden');
      return;
    }

    learnedEmptyState.classList.add('hidden');
    learnedTableWrapper.classList.remove('hidden');
    learnedTableBody.innerHTML = '';

    keys.forEach(k => {
      const item = learned[k];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(k)}</code></td>
        <td><strong>${escapeHtml(String(item.answer))}</strong></td>
        <td style="color:#94a3b8;font-size:12px;">${escapeHtml(item.reason || 'Manual')}</td>
        <td><button class="btn-icon-delete" data-key="${escapeHtml(k)}" title="Delete item">🗑️</button></td>
      `;
      learnedTableBody.appendChild(tr);
    });

    // Delete item listener
    learnedTableBody.querySelectorAll('.btn-icon-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const keyToDelete = btn.getAttribute('data-key');
        const storage = await getStorageData([STORAGE_KEYS.LEARNED_ANSWERS]);
        const curr = storage[STORAGE_KEYS.LEARNED_ANSWERS] || {};
        delete curr[keyToDelete];
        await setStorageData({ [STORAGE_KEYS.LEARNED_ANSWERS]: curr });
        renderLearnedAnswersTable(curr);
        showToast(`Removed learned answer for "${keyToDelete}"`, 'info');
      });
    });
  }

  function detectInitialFileLabel(fileName) {
    const lower = fileName.toLowerCase();
    if (/cover|motivation|statement/i.test(lower)) return 'cover_letter';
    if (/passport|id|license|proof|identity/i.test(lower)) return 'id_proof';
    if (/transcript|cert|portfolio|sample/i.test(lower)) return 'other_document';
    return 'resume';
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
